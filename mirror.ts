import { request, gql } from "graphql-request";
import axios from "axios";
import * as dotenv from "dotenv";
import { ANGLE_ONCHAIN_SUBGRAPH_URL } from "./utils/constants";
import { fetchSDProposal, SNAPSHOT_URL } from "./src/mirror/request";
import { createProposal, DEFAULT_MIN_TS, DELAY_ONE_DAYS, DELAY_TWO_DAYS, filterGaugesProposals } from "./src/mirror/utils";
import { SPACES } from "./src/mirror/spaces";
import { CHAT_ID_ERROR, sendMessage } from "./utils/telegram";

dotenv.config();

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

const SPACES_DEFAULT_MIN_TS: any = {
    "spectradao.eth": 1662377996,
    "cakevote.eth": 1701457094,
    "blackpoolhq.eth": 1701457094,
};

const fetchProtocolProposal = async ({ space, minCreated = DEFAULT_MIN_TS }: any) => {
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY, {
        spaces: [space],
        minCreated: minCreated,
    })) as any;
    return result.proposals;
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
            end = proposal.end - DELAY_ONE_DAYS;
        }

        console.log(`Handle proposal : ${proposal.title}`);

        proposal.end = end;
        proposal.metadata = { url: `https://snapshot.org/#/anglegovernance.eth/proposal/${proposal.id}` };

        // Exclude Angle scam proposal
        if (proposal.title.indexOf("After a Successful DAO Vote, Angle decided to Launch the 1 Phase of the $gANGLE Distribution") > -1) {
            continue;
        }

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

            // TODO : Delete, raw fix due to a subgraph non sync
            if (angleProposalKey == "0xd99b87995eb80a52da1ad6684a0cb746b40cefd74e536f9478785dc3c29c3dcc") {
                return null;
            }
            
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

const handlers: Record<string, (space: string) => Promise<void>> = {
    "frax.eth": handleBasicSnaphsot,
    "anglegovernance.eth": handleOnchainAngleSnaphsot,
    "balancer.eth": handleBasicSnaphsot,
    "blackpoolhq.eth": handleBasicSnaphsot,
    "spectradao.eth": handleBasicSnaphsot,
    "veyfi.eth": handleBasicSnaphsot,
    "mavxyz.eth": handleBasicSnaphsot,
    "fxn.eth": handleBasicSnaphsot,
   // "cakevote.eth": handleBasicSnaphsot,
};

const main = async () => {
    const spaces = Object.keys(SPACES);
    for (const space of spaces) {
        try {
            const handlerFunc = handlers[space];
            if (handlerFunc) {
                console.log("Execute space ", space)
                await handlers[space](space);
            }
        }
        catch (e) {
            console.error(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror proposal", `Space ${space} - ${e.error_description || e.message || ""}`);
        }
    }
    console.log("sync done");
    return;
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});