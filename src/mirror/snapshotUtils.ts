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
      created
    }
  }
`;

// The guard only protects against a write that just landed on the hub, so a
// match older than this window is a genuinely different proposal that happens
// to share the same title (ex: two Curve DAO votes with identical text but
// different vote ids) and must still be mirrored.
export const DUPLICATE_WINDOW = 2 * 3600;

export const fetchActiveProposalsInSpace = async (space: string): Promise<{ id: string; title: string; created: number }[]> => {
    const result = (await requestWithRetry(`${SNAPSHOT_URL}/graphql`, QUERY_ACTIVE_BY_SPACE, { space })) as any;
    return result.proposals;
};

// Pure: is there already an active proposal with this exact title in the space,
// created within the last DUPLICATE_WINDOW seconds?
export const hasProposalWithTitle = (
    proposals: { title: string; created: number }[],
    title: string,
    now: number = Math.floor(Date.now() / 1000),
): boolean => proposals.some((p) => p.title === title && Math.abs(now - p.created) <= DUPLICATE_WINDOW);