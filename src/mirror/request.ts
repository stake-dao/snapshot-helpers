import { GraphQLClient, gql, ClientError } from "graphql-request";
import { sleep } from "../../utils/sleep";

export const SNAPSHOT_URL = "https://hub.snapshot.org";

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;

// graphql-request defaults to node-fetch@2 (via cross-fetch), whose gzip
// decompression throws ERR_STREAM_PREMATURE_CLOSE when the snapshot hub closes
// the connection mid-response. That failure is deterministic, not transient, so
// retrying never recovers it. Node's native fetch (undici) decodes the same
// response correctly, so force every hub client to use it. Typed `any` because
// tsconfig's lib does not declare the fetch global.
export const nativeFetch: any = (globalThis as any).fetch;

// A ClientError with a 4xx status is a real, permanent failure (bad query/auth)
// and should fail fast. Anything else (5xx, network blips) is retried with
// exponential backoff.
export const requestWithRetry = async <T = any>(url: string, query: any, variables?: any): Promise<T> => {
    const client = new GraphQLClient(url, { fetch: nativeFetch });
    let lastError: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return (await client.request(query, variables)) as T;
        } catch (e: any) {
            lastError = e;
            const status = e instanceof ClientError ? e.response?.status : undefined;
            const permanent = status !== undefined && status >= 400 && status < 500;
            if (permanent || attempt === MAX_RETRIES) {
                break;
            }
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            console.log(`Snapshot request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${e.message || e}`);
            await sleep(delay);
        }
    }
    throw lastError;
};

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
    const result = (await requestWithRetry(`${SNAPSHOT_URL}/graphql`, QUERY_SD, { spaces: [space] })) as any;
    return result.proposals;
};