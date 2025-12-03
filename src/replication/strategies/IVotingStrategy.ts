import { TransactionReceipt } from "viem";
import { IProposalMessageForOperationChannel } from "../interfaces/IProposalMessageForOperationChannel";

export const MIN_GAS_LIMIT = BigInt("2000000");

export interface IVotingStrategy {
    /**
     * Name of the protocol (for logging/debugging)
     */
    name: string;

    /**
     * Filters the global list of votes to return only those relevant to this protocol.
     */
    filterVotes(votes: IProposalMessageForOperationChannel[]): IProposalMessageForOperationChannel[];

    /**
     * Executes the transaction on-chain (e.g., via Safe Module).
     * Returns the receipt, or undefined/null if failed/not needed.
     */
    execute(votes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null>;

    /**
     * Verifies if the votes were successfully cast on-chain (after the TX).
     */
    verify(votes: IProposalMessageForOperationChannel[]): Promise<boolean>;

    /**
     * Formats the success message for Telegram.
     * Logic is specific because args (yea/nay/amounts) differ per protocol.
     */
    formatSuccessMessage(votes: IProposalMessageForOperationChannel[], txHash: string): string;
}