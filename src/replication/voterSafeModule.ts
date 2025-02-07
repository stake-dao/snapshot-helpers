import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, toHex, TransactionReceipt } from "viem"
import { IProposalMessageForOperationChannel } from "./interfaces/IProposalMessageForOperationChannel";
import { CURVE_OWNERSHIP_VOTER, CURVE_PARAMETER_VOTER } from "./addresses";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";

const VOTER_CURVE_SAFE_MODULE = "0x665d334388012d17F1d197dE72b7b708ffCCB67d" as `0x${string}`;

type VoteParam = { _voteId: bigint; _yeaPct: bigint; _nayPct: bigint; _voteType: number; }
type VoteParams = readonly VoteParam[];

const abi = parseAbi([
    'function votes((uint256 _voteId, uint256 _yeaPct, uint256 _nayPct, uint8 _voteType)[] _votes) external'
]);

export const votesFromSafeModule = async (onchainVotes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null> => {
    try {
        const curvesVotes = onchainVotes.filter((onchainVote) => onchainVote.args.length === 4 && (onchainVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() || onchainVote.args[3].toLowerCase() === CURVE_PARAMETER_VOTER.toLowerCase()));
        if (curvesVotes.length === 0) {
            return null;
        }

        // Compute args
        const args = curvesVotes.map((curvesVote) => {
            return {
                _voteId: BigInt(curvesVote.args[0]), // vote id
                _yeaPct: BigInt(curvesVote.args[1]), // yea
                _nayPct: BigInt(curvesVote.args[2]), // nay
                _voteType: curvesVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() ? 0 : 1 // O for ownership and 1 for parameter
            } as VoteParam;
        }) as VoteParams;

        const account = privateKeyToAccount(process.env.SAFE_PROPOSER_PK as `0x${string}`);
        const rpcUrl = CHAIN_ID_TO_RPC[1];

        const publicClient = createPublicClient({
            chain: mainnet,
            transport: http(rpcUrl)
        })

        const walletClient = createWalletClient({
            chain: mainnet,
            transport: http(rpcUrl),
            account,
        });

        // Simulate, revert if there is a issue
        await publicClient.simulateContract({
            account,
            address: VOTER_CURVE_SAFE_MODULE,
            abi,
            functionName: 'votes',
            args: [args],
            chain: mainnet,
        });

        // Estimate gas limit
        const data = encodeFunctionData({
            abi,
            functionName: 'votes',
            args: [args]
        });

        const [gasLimit, { maxFeePerGas, maxPriorityFeePerGas }] = await Promise.all([
            publicClient.estimateGas({
                data,
                to: VOTER_CURVE_SAFE_MODULE,
                account,
            }),
            publicClient.estimateFeesPerGas()
        ])

        // Add 15%
        const increasedMaxFeePerGas = maxFeePerGas * 115n / 100n;
        const increasedMaxPriorityFeePerGas = maxPriorityFeePerGas * 115n / 100n;
        const increasedGasLimit = (gasLimit * 115n) / 100n;

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
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return receipt;
    }
    catch (e) {
        console.error(e);
        return undefined;
    }
}