import { createProposal, DELAY_THREE_DAYS, filterGaugesProposals, getTelegramBot, TELEGRAM_BOT_MIRROR_CHAT_ID } from "./utils";
import axios from "axios";
import * as dotenv from "dotenv";
import { fetchSDProposal, SnapshotProposal } from "./request";
import { SDCRVGOV } from "./spaces";
import { CurveMonitorProposal } from "./interfaces";

dotenv.config();


const mirrorCrv = async () => {
    console.log("Mirror CRV proposals")

    // Fetch last 1000 proposals on SD space
    const sdResult = await fetchSDProposal({ space: SDCRVGOV });
    const sdProposals = filterGaugesProposals(sdResult);

    // Fetch last 1000 on curvemonitor
    const currentProposals = await fetchCurveProposalWithCurveMonitor();

    // Remove proposals already added
    const result = removeProposalAdded(currentProposals, sdProposals);
    if (result.length === 0) {
        console.log("Nothing to mirror");
        return;
    }

    for (const data of result) {
        const body = `View more on ${getLink(data)}`;
        const proposal = {
            space: { id: "curve.eth" },
            type: "single-choice",
            title: data.metadata,
            body,
            choices: ["Yes", "No"],
            start: parseInt(data.start_date.toString(), 10),
            end: parseInt(data.start_date.toString(), 10) + DELAY_THREE_DAYS,
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
}

/**
 * Fetch proposals on curvemonitor
 * @returns last 1000 proposals
 */
const fetchCurveProposalWithCurveMonitor = async (): Promise<CurveMonitorProposal[]> => {
    const { data: proposals } = await axios.get("https://prices.curve.fi/v1/dao/proposals?pagination=100000");

    const results: CurveMonitorProposal[] = [];
    for (const proposal of proposals) {
        let [first, hash] = proposal.ipfs_metadata.split(":");
        if (!hash) {
            hash = first;
        }

        let metadata = "";
        if (proposal.metadata && proposal.metadata.length > 0) {
            metadata = proposal.metadata;
        } else {
            metadata = await getLabel(hash);
        }

        results.push({ ...proposal, metadata });
    }

    return results;
};

/**
 * Get title from IPFS
 * @param hash IPFS hash
 * @returns title
 */
const getLabel = async (hash: string) => {
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
            getTelegramBot().sendMessage(TELEGRAM_BOT_MIRROR_CHAT_ID, `error pinata : https://gateway.pinata.cloud/ipfs/${hash}`);

            console.log("error pinata : ", `https://gateway.pinata.cloud/ipfs/${hash}`);
            console.log(e);
            console.log("----");
            const { data } = await axios.get(`https://api.ipfsbrowser.com/ipfs/get.php?hash=${hash}`);
            return data.text;
        }
    }
};

/**
 * Get proposal not added, ie : SD proposals don't contain link
 * @param curveMonitorProposals All proposals
 * @param snapshotProposals Proposals already added
 * @returns Proposals not added
 */
const removeProposalAdded = (curveMonitorProposals: CurveMonitorProposal[], snapshotProposals: SnapshotProposal[]): CurveMonitorProposal[] => {
    return curveMonitorProposals.filter((curveMonitorProposal) => {
        const link = getLink(curveMonitorProposal).toLowerCase();
        return !snapshotProposals.some((snapshotProposal) => snapshotProposal.body.toLowerCase().indexOf(link) > -1);
    });
}

const getLink = (proposal: CurveMonitorProposal): string => {
    return `https://dao.curve.fi/vote/${proposal.vote_type.toLowerCase()}/${proposal.vote_id}`;
}

mirrorCrv().catch((e) => console.error(e));