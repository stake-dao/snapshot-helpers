export interface IProposalMessageForOperationChannel {
    text: string;
    deadline: number;
    payload: `0x${string}` | undefined;
    voter: string | undefined;
    args: any[],
    isOnchainProposal: boolean;
    proposalTitle: string;
}