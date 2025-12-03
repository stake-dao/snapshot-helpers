import { createProposal, DELAY_THREE_DAYS, filterGaugesProposals, getBlockAt } from "./utils";
import * as dotenv from "dotenv";
import { fetchSDProposal, SnapshotProposal } from "./request";
import { SD_YB_SPACE } from "./spaces";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import { request, gql } from "graphql-request";
import moment from "moment";

interface YBProposal {
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
    }
}

dotenv.config();

const mirrorYB = async () => {
    console.log("Mirror YB proposals")

    // Fetch last 1000 proposals on SD space
    const sdResult = await fetchSDProposal({ space: SD_YB_SPACE });
    const sdProposals = filterGaugesProposals(sdResult);

    // Fetch last 1000 on curvemonitor
    const currentProposals = await fetchYbProposals();

    // Remove proposals already added
    const result = removeProposalAdded(currentProposals, sdProposals);
    if (result.length === 0) {
        console.log("Nothing to mirror");
        return;
    }

    const now = moment.now()

    for (const data of result) {
        const title = getTitle(data);
        const end = data.endDate - DELAY_THREE_DAYS;
        if (end < now) {
            console.log(`Not enough timee or ended for proposal ${title}`);
            continue;
        }

        if (data.settings.votingMode === 1) {
            console.log(`Early mode activated for proposal ${title}, skip it`);
            continue;
        }

        const snapshot = await getBlockAt(data.snapshotTimestamp);

        const proposal = {
            space: { id: "yb.eth" },
            type: "single-choice",
            title,
            body: data.summary,
            choices: ["Yes", "No"],
            start: data.startDate,
            end,
            snapshot,
            network: "1",
            strategies: JSON.stringify({}),
            plugins: JSON.stringify({}),
        };

        // Remove urls i nthe title
        if (proposal.title) {
            proposal.title = removeUrls(proposal.title);
        }

        console.log(`Handle proposal :  ${proposal.title}`);
        console.log(`Start proposal :  ${proposal.start}`);
        console.log(`End proposal :  ${proposal.end}`);
        await createProposal({ payload: proposal });
    }
}

function removeUrls(text: string): string {
    return text.replace(/https?:\/\/[^\s]+/g, '').trim();
}

/**
 * Fetch proposals on curvemonitor
 * @returns last 1000 proposals
 */
const fetchYbProposals = async (): Promise<YBProposal[]> => {
    const result = (await request("https://data.yieldbasis.com/api/v1/graphql", gql`
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
            __typename
        }    
    `, { chainId: 1 })) as any;

    return result.proposals;
};

/**
 * Get proposal not added, ie : SD proposals don't contain link
 * @param proposals All proposals
 * @param snapshotProposals Proposals already added
 * @returns Proposals not added
 */
const removeProposalAdded = (proposals: YBProposal[], snapshotProposals: SnapshotProposal[]): YBProposal[] => {
    return proposals.filter((proposal) => {
        const title = getTitle(proposal).toLowerCase();
        return !snapshotProposals.some((snapshotProposal) => snapshotProposal.title.toLowerCase().indexOf(title) > -1);
    });
}

const getTitle = (proposal: YBProposal): string => {
    return `#${proposal.incrementalId} - ${proposal.title}`;
}

mirrorYB().catch((e) => {
    console.error(e);
    sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror YB", `${e.error_description || e.message || ""}`)
        .finally(() => process.exitCode = 1);
});