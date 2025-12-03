import { Address, createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, TransactionReceipt } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { IProposalMessageForOperationChannel } from "../interfaces/IProposalMessageForOperationChannel";
import { CURVE_OWNERSHIP_VOTER, CURVE_PARAMETER_VOTER } from "../addresses";
import { IVotingStrategy, MIN_GAS_LIMIT } from "./IVotingStrategy";
import { CHAIN_ID_TO_RPC } from "../../../utils/constants";

// Addresses & Constants
const VOTER_CURVE_SAFE_MODULE = "0xb118fbE8B01dB24EdE7E87DFD19693cfca13e992" as const;
const CRV_LOCKER = "0x52f541764E6e90eeBc5c21Ff570De0e2D63766B6" as Address;


// Types internal to Curve
type VoteParam = { _voteId: bigint; _yeaPct: bigint; _nayPct: bigint; _voteType: number; }
type VoteParams = readonly VoteParam[];

const abi = parseAbi([
    'function votes((uint256 _voteId, uint256 _yeaPct, uint256 _nayPct, uint8 _voteType)[] _votes) external',
    'function getVoterState(uint256 voteId, address voter) external view returns(uint8)'
]);

export class CurveVotingStrategy implements IVotingStrategy {
    public name = "Curve";

    filterVotes(votes: IProposalMessageForOperationChannel[]): IProposalMessageForOperationChannel[] {
        return votes.filter((onchainVote) =>
            onchainVote.args.length === 4 &&
            (onchainVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() ||
                onchainVote.args[3].toLowerCase() === CURVE_PARAMETER_VOTER.toLowerCase())
        );
    }

    async execute(votes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null> {
        try {
            // Compute args
            const args = votes.map((curvesVote) => {
                return {
                    _voteId: BigInt(curvesVote.args[0]), // vote id
                    _yeaPct: BigInt(curvesVote.args[1]), // yea
                    _nayPct: BigInt(curvesVote.args[2]), // nay
                    _voteType: curvesVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() ? 0 : 1
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
            console.error("[Curve Strategy] Error:", e);
            throw e; // Rethrow to let the main loop handle the error logging
        }
    }

    async verify(votes: IProposalMessageForOperationChannel[]): Promise<boolean> {
        const rpcUrl = CHAIN_ID_TO_RPC[1];
        const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });

        for (const curvesVote of votes) {
            const to = curvesVote.args[3]; // Voting contract
            const voteState = await publicClient.readContract({
                address: to as Address,
                abi,
                functionName: 'getVoterState',
                args: [BigInt(curvesVote.args[0]), CRV_LOCKER],
                authorizationList: undefined,
            });

            // Check if vote is still "Absent" (0)
            if (Number(voteState) === 0) return false;
        }
        return true;
    }

    formatSuccessMessage(votes: IProposalMessageForOperationChannel[], txHash: string): string {
        let message = "";
        for (const vote of votes) {
            const yea = BigInt(vote.args[1]);
            const nay = BigInt(vote.args[2]);
            const total = yea + nay;
            const yeaPercentage = Number(yea * BigInt(100) / total);
            const nayPercentage = Number(nay * BigInt(100) / total);

            message += `✅ ${vote.proposalTitle}\n`;
            message += `Result : Yes ${yeaPercentage.toFixed(2)}% - No ${nayPercentage}%\n\n`;
        }
        message += `Tx : <a href="https://etherscan.io/tx/${txHash}">etherscan.io</a>`;
        return message;
    }
}