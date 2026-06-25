import * as dotenv from "dotenv";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";
import { SNAPSHOT_URL, nativeFetch } from "./request";
import snapshot from "@snapshot-labs/snapshot.js";
import { fetchActiveProposalsInSpace, fetchNbActiveProtocolProposal, hasProposalWithTitle, MAX_LENGTH_BODY, MAX_LENGTH_TITLE } from "./snapshotUtils";
import { sleep } from "../../utils/sleep";
import { createPublicClient, http } from "viem";
import * as chains from 'viem/chains'
import axios from "axios";
import { SPACES } from "./spaces";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import { GraphQLClient, gql } from "graphql-request";

dotenv.config();

const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TG_API_KEY_GOV_CHANNEL;

export const DEFAULT_MIN_TS = 1648816320;
export const ONE_HOUR = 3600;
export const DELAY_THREE_DAYS = 3 * 24 * ONE_HOUR;
export const DELAY_TWO_DAYS = 2 * 24 * ONE_HOUR;
export const DELAY_ONE_DAYS = 1 * 24 * ONE_HOUR;
export const TELEGRAM_BOT_MIRROR_CHAT_ID = "-1001833039204";

export const getTelegramBot = () => {
    return new TelegramBot(token, { polling: false });
}

export const filterGaugesProposals = (proposals: any, space?: string) => {
    if (space === "veyfi.eth") {
        return proposals;
    }
    return proposals.filter((x: any) => !x.title.includes("Gauge vote"));
};

export const createProposal = async ({ payload }: any) => {
    console.log("payload", payload);
    const end = payload.end;

    if (end < payload.start) {
        console.log("NOT ENOUGH DELAY");
        return;
    }

    if (end < Date.now() / 1000) {
        console.log("ENDED");
        return;
    }

    const provider = new JsonRpcProvider(CHAIN_ID_TO_RPC[1]);
    const snapshotClient = new snapshot.Client712(SNAPSHOT_URL);
    const pks = [process.env.PK_1, process.env.PK_2, process.env.PK_3];
    const targetSpace = SPACES[payload.space.id];
    let created = false;

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

    for (const pk of pks) {
        const signer = new Wallet(pk, (provider as any));
        const address = signer.address;

        // Idempotency guard. snapshot.js' write can succeed on the hub while the
        // client throws reading the response (ERR_STREAM_PREMATURE_CLOSE). That
        // used to make the loop fail over to the next key and recreate the same
        // proposal, once per key. Re-check the target space before each attempt
        // so a proposal that already landed is never duplicated.
        if (hasProposalWithTitle(await fetchActiveProposalsInSpace(targetSpace), title)) {
            console.log("Proposal already active in " + targetSpace + ", skip: " + title);
            created = true;
            break;
        }

        const nbActiveProposal = await fetchNbActiveProtocolProposal(address);
        if (nbActiveProposal >= 10) {
            console.log("nbActiveProposal > 10 => " + nbActiveProposal + ", we can't add proposal for " + payload.space.id)
            continue;
        }

        let network = "1"
        switch (payload.space.id) {
            case "cakevote.eth":
                network = "56";
                break;
            case "frax.eth": {
                const publicClient = createPublicClient({
                    chain: chains.fraxtal,
                    transport: http("https://rpc.frax.com")
                });
                payload.snapshot = await getMainnetSnapshotBlock(publicClient, payload);
                break;
            }
            default:
                break;
        }

        const proposal: any = {
            space: targetSpace,
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
            created = true;
            break;
        } catch (e: any) {
            console.log("ERR", e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space ${targetSpace} - ${e.error_description || e.message || ""}`)
            // The write may have landed on the hub even though the client threw.
            // Verify (after a short indexing delay) before failing over to the
            // next key, otherwise we would create the proposal twice.
            await sleep(2000);
            if (hasProposalWithTitle(await fetchActiveProposalsInSpace(targetSpace), title)) {
                console.log("Proposal created despite client error, not retrying: " + title);
                created = true;
                break;
            }
        }
    }

    if (!created) {
        await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space ${targetSpace}`)
    }
};

const getMainnetSnapshotBlock = async (publicClient: any, payload: any): Promise<string> => {
    const block = await publicClient.getBlock({
        blockNumber: BigInt(payload.snapshot.toString()),
        includeTransactions: false
    });

    const mainnetBlock = await getBlockAt(Number(block.timestamp));
    return mainnetBlock.toString()
}

export const getBlockAt = async (timestamp: number): Promise<number> => {
    const { data: mainnetBlockRes } = await axios.get(`https://coins.llama.fi/block/ethereum/${timestamp}`);
    return mainnetBlockRes.height;
}

export interface YBProposal {
    id: string;
    incrementalId: number;
    chainId: number;
    title: string;
    description: string | null,
    summary: string;
    proposalIndex: string;
    snapshotTimestamp: number;
    startDate: number;
    endDate: number;
    createdAt: number;
    settings: {
        votingMode: number;
    };
    executed: {
        blockNumber: number;
        blockTimestamp: number;
    }
}

export const fetchYbProposals = async (): Promise<YBProposal[]> => {
    const client = new GraphQLClient("https://data.yieldbasis.com/api/v1/graphql", { fetch: nativeFetch });
    const result = (await client.request(gql`
        query GetAllProposals($chainId: Int!) {
            proposals: Proposal(limit: 1000, where: {chainId: {_eq: $chainId}}) {
                ...ProposalFields
                __typename
            }
        }

        fragment ParameterFieldsFragment on ActionParameter {
            id
            name
            notice
            parameterType
            value
            __typename
        }

        fragment ProposalFields on Proposal {
            id
            incrementalId
            chainId
            title
            description
            summary
            proposalIndex
            snapshotTimestamp
            startDate
            endDate
            createdAt
            settings {
                votingMode
                __typename
            }
            executed {
                blockNumber
                blockTimestamp
                __typename
            }
            __typename
        }    
    `, { chainId: 1 })) as any;

    return result.proposals;
};