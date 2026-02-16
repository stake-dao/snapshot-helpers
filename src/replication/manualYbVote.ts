/**
 * Manual YB Vote — unified workflow
 *
 * Usage:
 *   npx ts-node --transpile-only src/replication/manualYbVote.ts test      # Tenderly simulation
 *   npx ts-node --transpile-only src/replication/manualYbVote.ts execute   # On-chain execution
 *
 * Env vars:
 *   test mode    → TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT_SLUG, TENDERLY_PROJECT_SLUG
 *   execute mode → SAFE_PROPOSER_PK
 *   both         → WEB3_ALCHEMY_API_KEY (via constants)
 */

import { gql, GraphQLClient } from "graphql-request";
import * as dotenv from "dotenv";
import {
    createPublicClient, createWalletClient, encodeFunctionData,
    getAddress, http, parseAbi, parseEther,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";
import { simulateOnTenderly } from "../../utils/safe-proposer/tenderly-simulator";
import { YB_LOCKER, YB_VOTER, YIELDBASIS_VOTER } from "./addresses";
import { ybVoterAbi } from "./abi/ybVoter";
import { getVotingPowerWithDecay } from "./ybUtils";
import { fetchYbProposals } from "../mirror/utils";
import { SD_YB_SPACE } from "../mirror/spaces";
import { ProposalTally } from "./interfaces/yb";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const TARGET_IDS = [29, 30, 31, 32];

const YB_PLUGIN = getAddress("0xd7df8bd42e81a0fd68ac78254afdc0d7b6cbae9f");
const MIN_GAS_LIMIT = 2_000_000n;

const abi = parseAbi([
    'struct Tally { uint256 abstain; uint256 yes; uint256 no; }',
    'function votes((uint256 _voteId, Tally _tally, bool _tryEarlyExecution)[] _votes) external',
    'function getVotes(uint256 _proposalId, address _account) external view returns(Tally memory)',
]);

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = "test" | "execute";

interface Proposal {
    id: string;
    title: string;
    body: string;
    choices: string[];
    start: number;
    end: number;
    snapshot: string;
    state: string;
    author: string;
    created: number;
    type: string;
    scores: number[];
    quorum: number;
    network: string;
    space: { id: string; name: string; symbol: string };
}

type VoteArg = {
    _voteId: bigint;
    _tally: ProposalTally;
    _tryEarlyExecution: boolean;
};

// ─── Shared: build vote args ─────────────────────────────────────────────────

const buildVoteArgs = async (): Promise<{ voteArgs: VoteArg[]; titles: Map<string, string> }> => {
    // 1. Fetch active Snapshot proposals
    const graphqlClient = new GraphQLClient('https://hub.snapshot.org/graphql');
    const query = gql`
      {
        proposals(
          where: { space_in: ["${SD_YB_SPACE}"], state: "active" },
          orderBy: "created", orderDirection: desc, first: 100
        ) {
          id title body choices start end snapshot state author created type scores quorum network
          space { id name symbol }
        }
      }
    `;

    const { proposals: allProposals } = await graphqlClient.request<{ proposals: Proposal[] }>(query);
    const proposals = allProposals
        .filter((p) => TARGET_IDS.includes(parseInt(p.title.split("#")[0])))
        .sort((a, b) => parseInt(a.title.split("#")[0]) - parseInt(b.title.split("#")[0]));

    console.log(`Found ${proposals.length} active proposals for IDs ${TARGET_IDS.join(", ")}\n`);

    if (proposals.length === 0) return { voteArgs: [], titles: new Map() };

    // 2. Fetch YB on-chain proposals
    const ybProposals = await fetchYbProposals();

    // 3. Build args
    const voteArgs: VoteArg[] = [];
    const titles = new Map<string, string>();

    for (const proposal of proposals) {
        const incrementalId = parseInt(proposal.title.split("#")[0]);
        console.log(`--- #${incrementalId}: ${proposal.title} ---`);
        console.log(`  Scores: ${proposal.choices.map((c, i) => `${c}: ${proposal.scores[i]}`).join(", ")}`);

        const ybProposal = ybProposals.find((p) => p.incrementalId === incrementalId);
        if (!ybProposal) {
            console.log(`  SKIP: YB proposal not found`);
            continue;
        }
        if (ybProposal.executed.blockNumber > 0) {
            console.log(`  SKIP: Already executed on-chain`);
            continue;
        }

        const votingPower = await getVotingPowerWithDecay(BigInt(ybProposal.proposalIndex), YB_LOCKER);
        console.log(`  Proposal Index: ${ybProposal.proposalIndex}`);
        console.log(`  Voting Power:   ${votingPower}`);

        // Compute vote split
        let yea = 0, nay = 0, abstain = 0;
        for (let i = 0; i < proposal.scores.length; i++) {
            const choice = proposal.choices[i];
            const score = proposal.scores[i];
            if (choice === "Yes") yea += score;
            else if (choice === "No") nay += score;
            else if (choice === "Abstain") abstain += score;
        }

        const yeaBig = parseEther(yea.toString());
        const nayBig = parseEther(nay.toString());
        const abstainBig = parseEther(abstain.toString());
        const totalVotesBig = yeaBig + nayBig + abstainBig;

        let yesAmount = 0n, noAmount = 0n, abstainAmount = 0n;
        if (totalVotesBig > 0n) {
            yesAmount = (votingPower * yeaBig) / totalVotesBig;
            noAmount = (votingPower * nayBig) / totalVotesBig;
            abstainAmount = votingPower - yesAmount - noAmount;
        } else {
            abstainAmount = votingPower;
        }

        console.log(`  Split: Yes=${yesAmount}, No=${noAmount}, Abstain=${abstainAmount}\n`);

        const proposalIndex = BigInt(ybProposal.proposalIndex);
        voteArgs.push({
            _voteId: proposalIndex,
            _tally: { abstain: abstainAmount, yes: yesAmount, no: noAmount },
            _tryEarlyExecution: false,
        });
        titles.set(proposalIndex.toString(), proposal.title);
    }

    return { voteArgs, titles };
};

// ─── Test mode: Tenderly simulation ──────────────────────────────────────────

const runTest = async (voteArgs: VoteArg[]) => {
    const tenderlyConfig = {
        accessKey: process.env.TENDERLY_ACCESS_KEY || "",
        user: process.env.TENDERLY_ACCOUNT_SLUG || "",
        project: process.env.TENDERLY_PROJECT_SLUG || "",
    };

    if (!tenderlyConfig.accessKey || !tenderlyConfig.user || !tenderlyConfig.project) {
        console.error("Missing env: TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT_SLUG, TENDERLY_PROJECT_SLUG");
        process.exit(1);
    }

    // Authorized caller for YB_VOTER module
    const fromAddress = "0x9ba4bD7B72B3a3966EFff094e2C955448f7FA5A7";

    // Encode calldata
    const calldata = encodeFunctionData({
        abi,
        functionName: 'votes',
        args: [voteArgs as any],
    });

    console.log(`\n=== Tenderly Simulation ===`);
    console.log(`From:     ${fromAddress}`);
    console.log(`To:       ${YB_VOTER}`);
    console.log(`Votes:    ${voteArgs.length}`);
    console.log(`Calldata: ${calldata.slice(0, 66)}...\n`);

    const simulationUrl = await simulateOnTenderly(tenderlyConfig, {
        chainId: 1,
        from: fromAddress as `0x${string}`,
        to: YB_VOTER,
        input: calldata,
        value: "0",
    });

    console.log(`✅ Tenderly: ${simulationUrl}`);
};

// ─── Execute mode: on-chain tx ───────────────────────────────────────────────

const runExecute = async (voteArgs: VoteArg[], titles: Map<string, string>) => {
    if (!process.env.SAFE_PROPOSER_PK) {
        console.error("Missing env: SAFE_PROPOSER_PK");
        process.exit(1);
    }

    const account = privateKeyToAccount(process.env.SAFE_PROPOSER_PK as `0x${string}`);
    const rpcUrl = CHAIN_ID_TO_RPC[1];
    const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain: mainnet, transport: http(rpcUrl), account });

    console.log(`\n=== On-chain Execution ===`);
    console.log(`Account: ${account.address}`);
    console.log(`Target:  ${YB_VOTER}`);
    console.log(`Votes:   ${voteArgs.length}\n`);

    // Simulate first
    console.log("Simulating...");
    await publicClient.simulateContract({
        account,
        address: YB_VOTER,
        abi,
        functionName: 'votes',
        args: [voteArgs as any],
        chain: mainnet,
    });
    console.log("Simulation OK\n");

    // Gas estimation
    const data = encodeFunctionData({ abi, functionName: 'votes', args: [voteArgs as any] });
    const [gasLimit, { maxFeePerGas, maxPriorityFeePerGas }] = await Promise.all([
        publicClient.estimateGas({ data, to: YB_VOTER, account }),
        publicClient.estimateFeesPerGas(),
    ]);

    const increase = 150n;
    const increasedMaxFeePerGas = maxFeePerGas * increase / 100n;
    const increasedMaxPriorityFeePerGas = maxPriorityFeePerGas * increase / 100n;
    let increasedGasLimit = (gasLimit * increase) / 100n;
    if (increasedGasLimit < MIN_GAS_LIMIT) increasedGasLimit = MIN_GAS_LIMIT;

    console.log(`Gas: ${increasedGasLimit} | maxFee: ${increasedMaxFeePerGas} | priority: ${increasedMaxPriorityFeePerGas}`);

    // Send
    console.log("Sending tx...");
    const hash = await walletClient.writeContract({
        account,
        address: YB_VOTER,
        abi,
        functionName: 'votes',
        args: [voteArgs as any],
        maxFeePerGas: increasedMaxFeePerGas,
        maxPriorityFeePerGas: increasedMaxPriorityFeePerGas,
        gas: increasedGasLimit,
        chain: mainnet,
    });

    console.log(`Tx hash: ${hash}`);
    console.log("Waiting for receipt...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash, retryCount: 100 });
    console.log(`Status: ${receipt.status}`);
    console.log(`Block:  ${receipt.blockNumber}`);
    console.log(`Gas:    ${receipt.gasUsed}`);
    console.log(`https://etherscan.io/tx/${hash}\n`);

    // Verify votes
    if (receipt.status === "success") {
        console.log("Verifying votes on-chain...");
        let allOk = true;
        for (const arg of voteArgs) {
            const tally = await publicClient.readContract({
                address: YB_PLUGIN,
                abi,
                functionName: 'getVotes',
                args: [arg._voteId, YB_LOCKER],
            });

            const total = tally.abstain + tally.no + tally.yes;
            const title = titles.get(arg._voteId.toString()) || arg._voteId.toString();
            if (total === 0n) {
                console.log(`  ❌ ${title} — vote not recorded`);
                allOk = false;
            } else {
                console.log(`  ✅ ${title} — Yes: ${tally.yes}, No: ${tally.no}, Abstain: ${tally.abstain}`);
            }
        }
        console.log(allOk ? "\n✅ All votes verified" : "\n⚠️ Some votes failed verification");
    } else {
        console.log("❌ Transaction reverted");
    }
};

// ─── Entry ───────────────────────────────────────────────────────────────────

const main = async () => {
    const mode = (process.argv[2] || "").toLowerCase() as Mode;

    if (mode !== "test" && mode !== "execute") {
        console.log("Usage: npx ts-node --transpile-only src/replication/manualYbVote.ts <test|execute>");
        console.log("  test    → Tenderly simulation (no PK needed)");
        console.log("  execute → On-chain transaction (needs SAFE_PROPOSER_PK)");
        process.exit(1);
    }

    console.log(`Mode: ${mode.toUpperCase()}\n`);

    const { voteArgs, titles } = await buildVoteArgs();

    if (voteArgs.length === 0) {
        console.log("No votes to process.");
        return;
    }

    console.log(`=== ${voteArgs.length} votes ready ===\n`);

    if (mode === "test") {
        await runTest(voteArgs);
    } else {
        await runExecute(voteArgs, titles);
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
