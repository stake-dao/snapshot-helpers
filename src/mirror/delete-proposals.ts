import * as dotenv from "dotenv";
import { Wallet } from "ethers";
import snapshot from "@snapshot-labs/snapshot.js";
import { GraphQLClient, gql } from "graphql-request";
import { SNAPSHOT_URL, nativeFetch } from "./request";

dotenv.config();

// One-off / on-demand tool to delete Snapshot proposals (e.g. mirror duplicates).
// Usage: ts-node src/mirror/delete-proposals.ts <dry-run|execute> <id[,id...]>
// A proposal can only be deleted by its author, so each id is matched to the
// PK_1/PK_2/PK_3 key that signed it. Signing is offline; no RPC needed.

const QUERY = gql`
    query Proposals($ids: [String!]) {
        proposals(where: { id_in: $ids }, first: 1000) {
            id
            title
            state
            author
            space {
                id
            }
        }
    }
`;

const main = async () => {
    const mode = process.argv[2] === "execute" ? "execute" : "dry-run";
    const ids = process.argv
        .slice(3)
        .flatMap((arg) => arg.split(","))
        .map((id) => id.trim())
        .filter(Boolean);

    if (ids.length === 0) {
        console.log("No proposal ids provided. Usage: <dry-run|execute> <id[,id...]>");
        return;
    }

    const client = new snapshot.Client712(SNAPSHOT_URL);
    const gqlClient = new GraphQLClient(`${SNAPSHOT_URL}/graphql`, { fetch: nativeFetch });

    const wallets = [process.env.PK_1, process.env.PK_2, process.env.PK_3]
        .filter(Boolean)
        .map((pk) => new Wallet(pk as string));

    const { proposals } = (await gqlClient.request(QUERY, { ids })) as any;
    const byId = new Map<string, any>(proposals.map((p: any) => [p.id.toLowerCase(), p]));

    console.log(`Mode: ${mode}. Targets: ${ids.length}`);

    for (const id of ids) {
        const proposal = byId.get(id.toLowerCase());
        if (!proposal) {
            console.log(`[skip] ${id} - not found on hub`);
            continue;
        }

        const signer = wallets.find((w) => w.address.toLowerCase() === proposal.author.toLowerCase());
        if (!signer) {
            console.log(`[skip] ${id} - author ${proposal.author} is not one of PK_1/PK_2/PK_3`);
            continue;
        }

        console.log(`[${mode}] ${id} "${proposal.title}" state=${proposal.state} space=${proposal.space.id} author=${proposal.author}`);
        if (mode !== "execute") {
            continue;
        }

        try {
            const receipt = await client.cancelProposal(signer as any, signer.address, {
                space: proposal.space.id,
                proposal: id,
            });
            console.log(`  deleted:`, receipt);
        } catch (e: any) {
            console.log(`  ERROR deleting ${id}:`, e.error_description || e.message || e);
        }
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
