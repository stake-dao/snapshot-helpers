import { createPublicClient, createWalletClient, http, TransactionReceipt } from "viem"
import VoterSafeModuleAbi from "../../abis/VoterSafeModule.json";
import { IProposalMessageForOperationChannel } from "./interfaces/IProposalMessageForOperationChannel";
import { CURVE_OWNERSHIP_VOTER, CURVE_PARAMETER_VOTER } from "./addresses";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const VOTER_CURVE_SAFE_MODULE = "0x665d334388012d17F1d197dE72b7b708ffCCB67d" as `0x${string}`;

export const votesFromSafeModule = async (onchainVotes: IProposalMessageForOperationChannel[]): Promise<TransactionReceipt | undefined | null> => {
    try {
        const curvesVotes = onchainVotes.filter((onchainVote) => onchainVote.args.length === 4 && (onchainVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() || onchainVote.args[3].toLowerCase() === CURVE_PARAMETER_VOTER.toLowerCase()));
        if (curvesVotes.length === 0) {
            return null;
        }

        // Compute args
        const args = curvesVotes.map((curvesVote) => {
            return [
                curvesVote.args[0], // vote id
                curvesVote.args[1], // yea
                curvesVote.args[2], // nay
                curvesVote.args[3].toLowerCase() === CURVE_OWNERSHIP_VOTER.toLowerCase() ? 0 : 1 // O for ownership and 1 for parameter
            ];
        });

        const account = privateKeyToAccount(process.env.SAFE_PROPOSER_PK as `0x${string}`);

        const publicClient = createPublicClient({
            chain: mainnet,
            transport: http()
        })

        const walletClient = createWalletClient({
            chain: mainnet,
            transport: http(),
            account,
        });

        const { request } = await publicClient.simulateContract({
            account,
            address: VOTER_CURVE_SAFE_MODULE,
            abi: VoterSafeModuleAbi,
            functionName: 'votes',
            args: args,
        });

        const hash = await walletClient.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return receipt;
    }
    catch (e) {
        console.error(e);
        return undefined;
    }
}