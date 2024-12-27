
export interface CurveMonitorProposal {
    vote_id: number;
    vote_type: "ownership" | "parameter";
    creator: string;
    start_date: number;
    snapshot_block: number;
    ipfs_metadata: string;
    metadata: string;
    votes_for: string;
    votes_against: string;
    vote_count: number;
    support_required: string;
    min_accept_quorum: string;
    total_supply: string;
    executed: boolean;
    transaction_hash: string;
    dt: string;
}