import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, parseAbi, TransactionReceipt } from "viem";
import { IProposalMessageForOperationChannel } from "../interfaces/IProposalMessageForOperationChannel";
import { IVotingStrategy, MIN_GAS_LIMIT } from "./IVotingStrategy";
import { YB_LOCKER, YB_VOTER } from "../addresses";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID_TO_RPC } from "../../../utils/constants";
import { mainnet } from "viem/chains";
import { ProposalTally } from "../interfaces/yb";

type VoteParam = { _voteId: bigint; _tally: ProposalTally; _tryEarlyExecution: boolean; }
type VoteParams = readonly VoteParam[];

const VOTER_YB_SAFE_MODULE = "0x82499D0f7b0A648e8a99c8ab395c2cd3a9B7B8fD" as const;
const YB_PLUGIN = getAddress("0xd7df8bd42e81a0fd68ac78254afdc0d7b6cbae9f");

const abi = parseAbi([
    'struct Tally { uint256 abstain; uint256 yes; uint256 no; }',
    'function votes((uint256 _voteId, Tally _tally, bool _tryEarlyExecution)[] _votes) external',
    'function getVotes(uint256 _proposalId, address _account) external view returns(Tally memory)'
]);

export class YbVotingStrategy implements IVotingStrategy {
    public name = "YB";

    filterVotes(votes: IProposalMessageForOperationChannel[]): IProposalMessageForOperationChannel[] {
        return votes.filter((vote) => vote.voter === YB_VOTER);
    }

    async execute(votes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null> {
        try {

            // Compute args
            const args = votes.map((vote) => {
                const tally = vote.args[1] as ProposalTally;
                return {
                    _voteId: BigInt(vote.args[0]), // vote id
                    _tally: {
                        abstain: BigInt(tally.abstain),
                        yes: BigInt(tally.yes),
                        no: BigInt(tally.no),
                    } as ProposalTally,
                    _tryEarlyExecution: vote.args[2] as boolean,
                } as VoteParam;
            }) as any;

            const account = privateKeyToAccount(process.env.SAFE_PROPOSER_PK as `0x${string}`);
            const rpcUrl = CHAIN_ID_TO_RPC[1];

            const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
            const walletClient = createWalletClient({ chain: mainnet, transport: http(rpcUrl), account });

            // Simulate
            await publicClient.simulateContract({
                account,
                address: VOTER_YB_SAFE_MODULE,
                abi,
                functionName: 'votes',
                args: [args],
                chain: mainnet,
            });

            // Gas Estimation
            const data = encodeFunctionData({ abi, functionName: 'votes', args: [args] });
            const [gasLimit, { maxFeePerGas, maxPriorityFeePerGas }] = await Promise.all([
                publicClient.estimateGas({ data, to: VOTER_YB_SAFE_MODULE, account }),
                publicClient.estimateFeesPerGas()
            ]);

            // Add buffer
            const increase = 150n;
            const increasedMaxFeePerGas = maxFeePerGas * increase / 100n;
            const increasedMaxPriorityFeePerGas = maxPriorityFeePerGas * increase / 100n;
            let increasedGasLimit = (gasLimit * increase) / 100n;
            if (increasedGasLimit < MIN_GAS_LIMIT) increasedGasLimit = MIN_GAS_LIMIT;

            const hash = await walletClient.writeContract({
                account,
                address: VOTER_YB_SAFE_MODULE,
                abi,
                functionName: 'votes',
                args: [args],
                maxFeePerGas: increasedMaxFeePerGas,
                maxPriorityFeePerGas: increasedMaxPriorityFeePerGas,
                gas: increasedGasLimit,
                chain: mainnet
            });

            return await publicClient.waitForTransactionReceipt({ hash, retryCount: 100 });
        } catch (e) {
            console.error("[YB Strategy] Error:", e);
            throw e; // Rethrow to let the main loop handle the error logging
        }
    }

    async verify(votes: IProposalMessageForOperationChannel[]): Promise<boolean> {
        const rpcUrl = CHAIN_ID_TO_RPC[1];
        const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });

        for (const vote of votes) {
            const tally = await publicClient.readContract({
                address: YB_PLUGIN,
                abi,
                functionName: 'getVotes',
                args: [BigInt(vote.args[0]), YB_LOCKER],
                authorizationList: undefined,
            });

            // Check if vote is still "Absent" (0)
            const total = tally.abstain + tally.no + tally.yes;
            if (total === 0n) {
                return false;
            }
        }
        return true;
    }

    formatSuccessMessage(votes: IProposalMessageForOperationChannel[], txHash: string): string {
        let message = "✅ Yb Votes sent\n";
        for (const vote of votes) {
            const tally = vote.args[1] as ProposalTally;
            const total = tally.abstain + tally.no + tally.yes;
            const yeaPercentage = Number(tally.yes * BigInt(100) / total);
            const nayPercentage = Number(tally.no * BigInt(100) / total);
            const abstainPercentage = Number(tally.abstain * BigInt(100) / total);

            message += `✅ ${vote.proposalTitle}\n`;
            message += `Result : Abstain ${abstainPercentage.toFixed(2)} - Yes ${yeaPercentage.toFixed(2)}% - No ${nayPercentage}%\n\n`;
        }
        return `Tx : <a href="https://etherscan.io/tx/${txHash}">etherscan.io</a>`;
    }
}