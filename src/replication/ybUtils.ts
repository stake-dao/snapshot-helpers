import { Address, createPublicClient, http, PublicClient } from "viem";
import { ybTokenAbi, ybVoterAbi } from "./abi/ybVoter";
import { YIELDBASIS_VOTER } from "./addresses";
import { mainnet } from "viem/chains";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";

function calculateDecayedVotingPower(
    snapshotPower: bigint,
    currentTime: bigint,
    startDate: bigint,
    endDate: bigint,
    decayMidpointBasisPoints: bigint
): bigint {

    // 1. If proposal has ended, voting power is 0
    if (currentTime >= endDate) {
        return 0n;
    }

    // 2. Calculate duration and midpoint
    const duration = endDate - startDate;

    // Solidity: startDate + (duration * decayMidpointBasisPoints) / 10000;
    const midpoint = startDate + (duration * decayMidpointBasisPoints) / 10000n;

    // 3. Before midpoint: full voting power
    if (currentTime <= midpoint) {
        return snapshotPower;
    }

    // 4. After midpoint: linear decay
    const timeRemaining = endDate - currentTime;
    const decayDuration = endDate - midpoint;

    // Solidity: (snapshotPower * timeRemaining) / decayDuration;
    // Note: Division in BigInt automatically floors the result (like Solidity)
    return (snapshotPower * timeRemaining) / decayDuration;
}

/**
 * Main Async Function: Fetches data from blockchain and runs the calculation.
 */
export async function getVotingPowerWithDecay(
    proposalId: bigint,
    accountAddress: Address,
): Promise<bigint> {
    const client = createPublicClient({
        chain: mainnet,
        transport: http(CHAIN_ID_TO_RPC[1])
    });

    console.log(`Calculating voting power for ${accountAddress} on proposal ${proposalId}...`);

    // A. Fetch all required contract state in parallel
    const [proposalData, decayMidpoint, votingTokenAddress] = await Promise.all([
        client.readContract({
            address: YIELDBASIS_VOTER,
            abi: ybVoterAbi,
            functionName: 'getProposal',
            args: [proposalId],
            authorizationList: undefined,
        }),
        client.readContract({
            address: YIELDBASIS_VOTER,
            abi: ybVoterAbi,
            functionName: 'getDecayMidpointBasisPoints',
            authorizationList: undefined,
        }),
        client.readContract({
            address: YIELDBASIS_VOTER,
            abi: ybVoterAbi,
            functionName: 'getVotingToken',
            authorizationList: undefined,
        })
    ]);

    const params = proposalData[2]; // 'parameters' is the 3rd element in the tuple

    // B. Fetch the user's snapshot power from the token contract
    const snapshotPower = await client.readContract({
        address: votingTokenAddress,
        abi: ybTokenAbi,
        functionName: 'getPastVotes',
        args: [accountAddress, params.snapshotTimepoint],
        authorizationList: undefined,
    });

    // C. Get current block timestamp to simulate "block.timestamp"
    const block = await client.getBlock();
    const currentTime = block.timestamp;

    console.log(`Snapshot Power: ${snapshotPower}`);
    console.log(`Current Time:   ${currentTime}`);

    // D. Run the calculation
    const currentVotingPower = calculateDecayedVotingPower(
        snapshotPower,
        currentTime,
        params.startDate,
        params.endDate,
        BigInt(decayMidpoint) // Convert uint32 to bigint
    );

    return currentVotingPower;
}