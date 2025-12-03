import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, TransactionReceipt } from "viem";
import { IProposalMessageForOperationChannel } from "../interfaces/IProposalMessageForOperationChannel";
import { IVotingStrategy, MIN_GAS_LIMIT } from "./IVotingStrategy";
import { YB_VOTER } from "../addresses";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID_TO_RPC } from "../../../utils/constants";
import { mainnet } from "viem/chains";
import { ProposalTally } from "../interfaces/yb";

type VoteParam = { _voteId: bigint; _votes: ProposalTally; _tryEarlyExecution: boolean; }
type VoteParams = readonly VoteParam[];

const abi = parseAbi([
    'struct Tally { uint256 abstain; uint256 yes; uint256 no; }',
    'function votes((uint256 _voteId, Tally _votes, bool _tryEarlyExecution)[] _votes) external',
    'function getVoterState(uint256 voteId, address voter) external view returns(uint8)'
]);

export class YbVotingStrategy implements IVotingStrategy {
    public name = "Yearn";

    filterVotes(votes: IProposalMessageForOperationChannel[]): IProposalMessageForOperationChannel[] {
        return votes.filter((vote) => vote.voter === YB_VOTER);
    }

    async execute(votes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null> {
        try {

            // Compute args
            const args = votes.map((curvesVote) => {
                const tally = curvesVote.args[1] as any[];
                return {
                    _voteId: BigInt(curvesVote.args[0]), // vote id
                    _votes: {
                        abstain: BigInt(tally[0]),
                        yes: BigInt(tally[1]),
                        no: BigInt(tally[2]),
                    },
                    _tryEarlyExecution: curvesVote.args[2] as boolean,
                } as VoteParam;
            }) as VoteParams;

            const account = privateKeyToAccount(process.env.SAFE_PROPOSER_PK as `0x${string}`);
            const rpcUrl = CHAIN_ID_TO_RPC[1];

            const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
            const walletClient = createWalletClient({ chain: mainnet, transport: http(rpcUrl), account });

            // Simulate
            await publicClient.simulateContract({
                account,
                address: VOTER_CURVE_SAFE_MODULE,
                abi,
                functionName: 'votes',
                args: [args],
                chain: mainnet,
            });

            // Gas Estimation
            const data = encodeFunctionData({ abi, functionName: 'votes', args: [args] });
            const [gasLimit, { maxFeePerGas, maxPriorityFeePerGas }] = await Promise.all([
                publicClient.estimateGas({ data, to: VOTER_CURVE_SAFE_MODULE, account }),
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
                address: VOTER_CURVE_SAFE_MODULE,
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
        return true;
    }

    formatSuccessMessage(votes: IProposalMessageForOperationChannel[], txHash: string): string {
        return `✅ Yb Votes sent\nTx: ${txHash}`;
    }
}