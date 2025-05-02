import { SNAPSHOT_URL } from "./request";
import { request, gql } from "graphql-request";

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
    const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY_ACTIVE, {
        author
    })) as any;
    return result.proposals.length;
};