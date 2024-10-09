import { request, gql } from "graphql-request";
import snapshot from "@snapshot-labs/snapshot.js";
import { JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";
import * as dotenv from "dotenv";
import { ANGLE_ONCHAIN_SUBGRAPH_URL } from "./utils/constants";
import { Wallet } from "ethers";
import { createPublicClient, http } from "viem";
import * as chains from 'viem/chains'
import { sendMessage } from "./utils/telegram";

dotenv.config();

const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TG_API_KEY_GOV_CHANNEL;
const chatId = "-1001833039204";
const bot = new TelegramBot(token, { polling: false });

// https://github.com/snapshot-labs/snapshot.js/blob/master/src/schemas/proposal.json
const MAX_LENGTH_TITLE = 256;
const MAX_LENGTH_BODY = 10000;

const SNAPSHOT_URL = "https://hub.snapshot.org";
const RPC_PROVIDER_URL = "http://3.143.14.91:8545";

const QUERY = gql`
	query Proposals($spaces: [String!]!, $minCreated: Int!) {
		proposals(first: 1000, orderBy: "end", orderDirection: asc, where: { space_in: $spaces, created_gt: $minCreated }) {
			id
			start
			end
			title
			body
			type
			created
			choices
			snapshot
			space {
				id
			}
		}
	}
`;

const QUERY_ACTIVE = gql`
query Proposal($author: String) {
	proposals(
	  where: {
		state: "active"
		author: $author
	  }
	  orderBy: "created"
	  orderDirection: desc
	) {
	  id
	}
  }
`;

const QUERY_SD = gql`
	query Proposals($spaces: [String!]!) {
		proposals(first: 1000 orderBy: "created", orderDirection: desc, where: { space_in: $spaces }) {
			id
			start
			end
			title
			body
			type
			created
			choices
			snapshot
			space {
				id
			}
		}
	}
`;

const ANGLE_ONCHAIN_QUERY = gql`
query Proposals($deadlineTimestamp: Int!, $snapshotTimestamp: Int!) {
	proposals(first: 1000 orderBy: "creationTimestamp" orderDirection: desc where:{deadlineTimestamp_gt: $deadlineTimestamp, snapshotTimestamp_lte: $snapshotTimestamp}) {
		id
		description
		proposer
		creationBlock
		snapshotBlock
		creationTimestamp
		snapshotTimestamp
		deadlineTimestamp
		queuedTimestamp
		creationTxHash
	}
}
`;

const DEFAULT_MIN_TS = 1648816320;
const ONE_HOUR = 3600;
const DELAY_THREE_DAYS = 3 * 24 * ONE_HOUR;
const DELAY_TWO_DAYS = 2 * 24 * ONE_HOUR;
const DELAY_ONE_DAYS = 1 * 24 * ONE_HOUR;
const SDCRVGOV = "sdcrv-gov.eth";

const SPACES: any = {
    "frax.eth": "sdfxs.eth",
    "anglegovernance.eth": "sdangle.eth",
    "balancer.eth": "sdbal.eth",
    "curve.eth": SDCRVGOV,
    "spectradao.eth": "sdapw.eth",
    "veyfi.eth": "sdyfi.eth",
    "mavxyz.eth": "sdmav.eth",
    "fxn.eth": "sdfxn.eth",
    "cakevote.eth": "sdcake.eth",
    "blackpoolhq.eth": "sdbpt.eth"
};

const SPACES_DEFAULT_MIN_TS: any = {
    "spectradao.eth": 1662377996,
    "cakevote.eth": 1701457094,
    "blackpoolhq.eth": 1701457094,
};

const provider = new JsonRpcProvider(RPC_PROVIDER_URL);
const snapshotClient = new snapshot.Client712(SNAPSHOT_URL);

const errorsCreateProposal: any = {};

const createProposal = async ({ payload }: any) => {
    console.log("payload", payload);
    const proposalId = payload.id || payload?.metadata?.url || "";
    const key = payload.space.id + "-" + proposalId;

    const end = payload.end;

    if (end < payload.start) {
        console.log("NOT ENOUGH DELAY");
        delete errorsCreateProposal[key];
        return;
    }

    if (end < Date.now() / 1000) {
        console.log("ENDED");
        delete errorsCreateProposal[key];
        return;
    }

    let lastError: any = null;
    const pks = [process.env.PK_1, process.env.PK_2, process.env.PK_3];
    for (const pk of pks) {
        const signer = new Wallet(pk, provider);
        const address = signer.address;
        const nbActiveProposal = await fetchNbActiveProtocolProposal(address);
        if (nbActiveProposal >= 10) {
            console.log("nbActiveProposal > 10 => " + nbActiveProposal + ", we can't add proposal for " + payload.space.id)
            continue;
        }

        let title = payload.title;
        let body = payload.body;

        if (title && title.length > MAX_LENGTH_TITLE) {
            title = title.substring(0, MAX_LENGTH_TITLE - 3) + "...";
        }

        if (body && body.length > MAX_LENGTH_BODY) {
            body = body.substring(0, MAX_LENGTH_BODY - 3) + "...";
        }

        title = title || "No title";
        body = body || "No body";

        let network = "1"
        switch (payload.space.id) {
            case "cakevote.eth":
                network = "56";
                break;
            case "frax.eth":
                const publicClient = createPublicClient({
                    chain: chains.fraxtal,
                    transport: http("https://rpc.frax.com")
                });
                const block = await publicClient.getBlock({
                    blockNumber: BigInt(payload.snapshot.toString()),
                    includeTransactions: false
                });
                const blockTimestamp = Number(block.timestamp);
                const { data: mainnetBlockRes } = await axios.get(`https://coins.llama.fi/block/ethereum/${blockTimestamp}`);
                const mainnetBlock = mainnetBlockRes.height;
                payload.snapshot = mainnetBlock.toString()
                break;
            default:
                break;
        }

        const proposal: any = {
            space: SPACES[payload.space.id],
            type: payload.type,
            title: title,
            name: title,
            body,
            choices: payload.choices,
            start: payload.start,
            end: end,
            snapshot: parseInt(payload.snapshot),
            network,
            strategies: JSON.stringify({}),
            plugins: JSON.stringify({}),
            metadata: JSON.stringify({}),
        };

        try {
            const receipt = await snapshotClient.proposal(signer as any, address, proposal);
            console.log(receipt);
            lastError = null;

            if (errorsCreateProposal[key]) {
                bot.sendMessage(chatId, 'Error for proposal ' + proposalId + " in space " + SPACES[payload.space.id] + " resolved");
                delete errorsCreateProposal[key];
            }

            break;
        } catch (err: any) {
            lastError = err;
            console.log("ERR", err);
        }
    }

    if (lastError && !errorsCreateProposal[key]) {
        const errTxt = lastError?.error_description || "";
        //bot.sendMessage(chatId, 'Error when mirror proposal ' + proposalId + ' in space ' + SPACES[payload.space.id] + " - " + errTxt + " - waiting resolution");

        errorsCreateProposal[key] = errTxt;
    }
};

const fetchNbActiveProtocolProposal = async (author: string) => {
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY_ACTIVE, {
        author
    })) as any;
    return result.proposals.length;
};

const getLabel = async (hash: string) => {
    //const { data } = await axios.get(`https://api.ipfsbrowser.com/ipfs/get.php?hash=${hash}`);
    try {
        const { data } = await axios.get(`https://gateway.pinata.cloud/ipfs/${hash}`, {
            headers: {
                'Accept': 'Accept: text/plain'
            }
        });
        return data.text;
    }
    catch (e) {
        let found = false;
        try {
            const { data } = await axios.get("https://api-py.llama.airforce/curve/v1/dao/proposals");
            for (const proposal of data.proposals) {
                if (!proposal.ipfsMetadata) {
                    continue;
                }

                if (proposal.ipfsMetadata.toLowerCase().indexOf(hash.toLowerCase()) > -1) {
                    found = true;
                    return proposal.metadata;
                }
            }
        }
        catch (e) {

        }

        if (!found) {
            bot.sendMessage(chatId, `error pinata : https://gateway.pinata.cloud/ipfs/${hash}`);

            console.log("error pinata : ", `https://gateway.pinata.cloud/ipfs/${hash}`);
            console.log(e);
            console.log("----");
            const { data } = await axios.get(`https://api.ipfsbrowser.com/ipfs/get.php?hash=${hash}`);
            return data.text;
        }
    }
};

const fetchProtocolProposal = async ({ space, minCreated = DEFAULT_MIN_TS }: any) => {
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY, {
        spaces: [space],
        minCreated: minCreated,
    })) as any;
    return result.proposals;
};

const fetchCurveProposalWithCurveMonitor = async (minCreated = DEFAULT_MIN_TS) => {
    const { data: result } = await axios.get("https://prices.curve.fi/v1/dao/proposals?pagination=100000");

    const proposals = result.proposals.filter((p: any) => p.ipfs_metadata !== null && p.start_date > minCreated);
    const results = [];
    for (const proposal of proposals) {
        let [first, hash] = proposal.ipfs_metadata.split(":");
        if (!hash) {
            hash = first;
        }
        const label = await getLabel(hash);
        results.push({ ...proposal, label });
    }

    return results;
};

const fetchSDProposal = async ({ space }: any) => {
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY_SD, { spaces: [space] })) as any;
    return result.proposals;
};

const filterGaugesProposals = (proposals: any, space?: string) => {
    if (space === "veyfi.eth") {
        return proposals;
    }
    return proposals.filter((x: any) => !x.title.includes("Gauge vote"));
};

const handleBasicSnaphsot = async (space: string) => {
    console.log(`Handle ${space}`);
    const sdResult = await fetchSDProposal({ space: SPACES[space] });
    const sdProposals = filterGaugesProposals(sdResult, space);
    let minCreated = sdProposals?.[0]?.created;
    if (!minCreated && SPACES_DEFAULT_MIN_TS[space]) {
        minCreated = SPACES_DEFAULT_MIN_TS[space];
    }

    const result = await fetchProtocolProposal({ space, minCreated });
    for (const proposal of result) {
        let end = proposal.end;
        if (space === 'cakevote.eth' || space === 'spectradao.eth') {
            end = proposal.end - DELAY_ONE_DAYS;
        } else {
            end = proposal.end - DELAY_TWO_DAYS;
        }

        if (space === "veyfi.eth" && proposal.title?.indexOf("dYFI emission") > -1) {
            proposal.title = "Gauge vote YFI - " + proposal.title;
            end  = proposal.end - DELAY_ONE_DAYS;
        }

        console.log(`Handle proposal : ${proposal.title}`);

        proposal.end = end;
        proposal.metadata = { url: `https://snapshot.org/#/anglegovernance.eth/proposal/${proposal.id}` };

        await createProposal({ payload: proposal });
    }
    console.log(`End handle ${space}`);
};

const handleOnchainAngleSnaphsot = async (space: string) => {
    try {
        // for snapshot governance
        await handleBasicSnaphsot(space);
    }
    catch (e) {

    }
    console.log(`Handle ${space}`);

    let sdResult = await fetchSDProposal({ space: SPACES[space] });
    sdResult = filterGaugesProposals(sdResult, space);

    const now = Math.floor(Date.now() / 1000);
    let subgraphResults: any = await request(ANGLE_ONCHAIN_SUBGRAPH_URL, ANGLE_ONCHAIN_QUERY, {
        deadlineTimestamp: now,
        snapshotTimestamp: now,
    });

    const { data: angleProposals } = await axios.get("https://api.angle.money/v1/governance?chainId=1");

    const result = (await Promise.all(subgraphResults.proposals.map(async (p: any) => {

        // Check if cancelled
        const angleProposalKey = Object.keys(angleProposals.proposalsInfo).find((proposalId: string) => p.id.toLowerCase() === proposalId.toLowerCase());
        if (angleProposalKey) {
            const angleProposal = angleProposals.proposalsInfo[angleProposalKey];
            if (angleProposal.state === 2) {
                return null;
            }
        }

        let body = "";
        try {
            const resp = await axios.get(`https://angle-blog.infura-ipfs.io/${p.description.replace("ipfs://", "ipfs/")}`);
            body = resp.data;
        }
        catch (e) {
            console.log('Error for proposal ' + p.id + " in space " + SPACES[space] + ", can't fetch ipfs : " + p.description);
            return null;
        }

        const lines = body.split("\n");
        let title = "";
        if (lines.length > 0) {
            title = lines[0];
            if (title[0] === '#') {
                title = title.slice(1);
            }
        }

        if (title.length === 0) {
            return null;
        }

        for (const sdProposa of sdResult) {
            if (sdProposa.title === title) {
                return null;
            }
        }

        return {
            title,
            id: p.id,
            space: {
                id: space,
            },
            end: parseInt(p.deadlineTimestamp),
            start: parseInt(p.snapshotTimestamp),
            type: "weighted", // Always weighted
            body,
            choices: ["Against", "For", "Abstain"], // Always this order see : https://github.com/OpenZeppelin/openzeppelin-contracts/blob/72c642e13e4e8c36da56ebeeecf2ee3e4abe9781/contracts/governance/extensions/GovernorCountingSimple.sol#L15
            snapshot: parseInt(p.snapshotBlock),
        }
    })))
        .filter((p: any) => p !== null);

    for (const proposal of result) {
        proposal.end = proposal.end - DELAY_TWO_DAYS;

        console.log(`Handle proposal :  ${proposal.title}`);

        await createProposal({ payload: proposal });
    }
};

const handleCurve = async () => {
    console.log("handleCurve")
    const sdResult = await fetchSDProposal({ space: SDCRVGOV });
    const sdProposals = filterGaugesProposals(sdResult);
    const minCreated = sdProposals?.[0]?.created;
    const result = await fetchCurveProposalWithCurveMonitor(minCreated);

    for (const data of result) {
        const link = `https://dao.curve.fi/vote/${data.vote_type.toLowerCase()}/${data.vote_id}`;
        const body = `View more on ${link}`;

        const proposal = {
            space: { id: "curve.eth" },
            type: "single-choice",
            title: data.metadata,
            body: body,
            choices: ["Yes", "No"],
            start: parseInt(data.start_date, 10),
            end: parseInt(data.start_date, 10) + DELAY_THREE_DAYS,
            snapshot: data.snapshot_block,
            network: "1",
            strategies: JSON.stringify({}),
            plugins: JSON.stringify({}),
            metadata: { url: `https://dao.curve.fi/vote/${data.vote_type.toLowerCase()}/${data.vote_id}` },
        };

        console.log(`Handle proposal :  ${proposal.title}`);
        console.log(`Start proposal :  ${proposal.start}`);
        console.log(`End proposal :  ${proposal.end}`);
        await createProposal({ payload: proposal });
    }
};

const handlers: Record<string, (space: string) => Promise<void>> = {
    "frax.eth": handleBasicSnaphsot,
    "anglegovernance.eth": handleOnchainAngleSnaphsot,
    "balancer.eth": handleBasicSnaphsot,
    "blackpoolhq.eth": handleBasicSnaphsot,
    "spectradao.eth": handleBasicSnaphsot,
    "veyfi.eth": handleBasicSnaphsot,
    "mavxyz.eth": handleBasicSnaphsot,
    "fxn.eth": handleBasicSnaphsot,
    "cakevote.eth": handleBasicSnaphsot,
    "curve.eth": handleCurve,
};

const main = async () => {
    const spaces = Object.keys(SPACES);
    for (const space of spaces) {
        try {
            console.log("execute space ", space)
            await handlers[space](space);
        }
        catch (e) {
            console.error(e);
            await sendMessage("Mirror proposal", `Space ${space} - ${e.error_description || e.message || ""}`);
        }
    }
    console.log("sync done");
    await bot.stopPolling();
    return;
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});