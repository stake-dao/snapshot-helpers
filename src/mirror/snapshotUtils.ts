import { SNAPSHOT_URL, nativeFetch, requestWithRetry } from "./request";
import { GraphQLClient, gql } from "graphql-request";

// https://github.com/snapshot-labs/snapshot.js/blob/master/src/schemas/proposal.json
export const MAX_LENGTH_TITLE = 256;
export const MAX_LENGTH_BODY = 10000;

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

export const QUERY_BY_ID = gql`
query Proposal($id: String) {
    proposals(
      where: {
        id: $id
      }
    ) {
      id
      title
      body
      choices
      start
      end
      snapshot
      state
      author
      created
      network
      space {
          id
          name
          symbol
      }
    }
  }
`;

export const fetchNbActiveProtocolProposal = async (author: string) => {
    const client = new GraphQLClient(`${SNAPSHOT_URL}/graphql`, { fetch: nativeFetch });
    const result = (await client.request(QUERY_ACTIVE, {
        author
    })) as any;
    return result.proposals.length;
};

const QUERY_ACTIVE_BY_SPACE = gql`
query ProposalsBySpace($space: String!) {
    proposals(
      where: {
        space: $space
        state: "active"
      }
      first: 1000
      orderBy: "created"
      orderDirection: desc
    ) {
      id
      title
    }
  }
`;

export const fetchActiveProposalsInSpace = async (space: string): Promise<{ id: string; title: string }[]> => {
    const result = (await requestWithRetry(`${SNAPSHOT_URL}/graphql`, QUERY_ACTIVE_BY_SPACE, { space })) as any;
    return result.proposals;
};

// Pure: is there already an active proposal with this exact title in the space?
export const hasProposalWithTitle = (proposals: { title: string }[], title: string): boolean =>
    proposals.some((p) => p.title === title);