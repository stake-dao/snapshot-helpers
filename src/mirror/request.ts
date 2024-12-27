import { request, gql } from "graphql-request";

export const SNAPSHOT_URL = "https://hub.snapshot.org";

export interface SnapshotProposal {
    id: string;
    start: number;
    end: number;
    created: number;
    title: string;
    body: string;
    type: string;
    choices: string[];
    snapshot: number;
    space: {
        id: string;
    }
}

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

export const fetchSDProposal = async ({ space }: any): Promise<SnapshotProposal[]> => {
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY_SD, { spaces: [space] })) as any;
    return result.proposals;
};