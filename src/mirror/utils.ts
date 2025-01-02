import * as dotenv from "dotenv";
import { Wallet } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";
import { SNAPSHOT_URL } from "./request";
import snapshot from "@snapshot-labs/snapshot.js";
import { fetchNbActiveProtocolProposal, MAX_LENGTH_BODY, MAX_LENGTH_TITLE } from "./snapshotUtils";
import { createPublicClient, http } from "viem";
import * as chains from 'viem/chains'
import axios from "axios";
import { SPACES } from "./spaces";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";

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
    let created = false;

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
            case "frax.eth": {
                const publicClient = createPublicClient({
                    chain: chains.fraxtal,
                    transport: http("https://rpc.frax.com")
                });
                payload.snapshot = await getMainnetSnapshotBlock(publicClient, payload);
                break;
            } case "spectradao.eth": {
                const publicClient = createPublicClient({
                    chain: chains.base,
                    transport: http()
                });
                payload.snapshot = await getMainnetSnapshotBlock(publicClient, payload);
                break;
            } default:
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
            created = true;
            break;
        } catch (e: any) {
            console.log("ERR", e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space ${SPACES[payload.space.id]} - ${e.error_description || e.message || ""}`)
        }
    }

    if (!created) {
        await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space ${SPACES[payload.space.id]}`)
    }
};

const getMainnetSnapshotBlock = async (publicClient: any, payload: any): Promise<string> => {
    const block = await publicClient.getBlock({
        blockNumber: BigInt(payload.snapshot.toString()),
        includeTransactions: false
    });

    const { data: mainnetBlockRes } = await axios.get(`https://coins.llama.fi/block/ethereum/${Number(block.timestamp)}`);
    const mainnetBlock = mainnetBlockRes.height;
    return mainnetBlock.toString()
}