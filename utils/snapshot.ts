import { gql, GraphQLClient } from "graphql-request";
import { GraphQLResponse, Proposal } from "../src/replication/interfaces/graphql";

export const getProposalById = async (id: string): Promise<Proposal[]> => {
    const graphqlClient = new GraphQLClient('https://hub.snapshot.org/graphql');
    let proposals: Proposal[] = [];

    // Requête GraphQL
    const query = gql`
      {
        proposals(
          where: {
            id: "${id}",
            state: "closed"
          },
          orderBy: "created",
          orderDirection: desc,
          first: 1000
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
          type
          scores
          quorum
          network
          space {
            id
            name
            symbol
          }
        }
      }
    `;

    try {
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);
        proposals = graphqlResponse.proposals;
    } catch (err) {
        console.error('Erreur lors de la requête GraphQL:', err);
        throw err;
    }

    return proposals;
}