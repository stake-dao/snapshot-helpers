import { parseAbi } from "viem";

export const ybVoterAbi = parseAbi([
    'struct ProposalParameters { uint8 votingMode; uint32 supportThreshold; uint64 startDate; uint64 endDate; uint64 snapshotTimepoint; uint256 minVotingPower; }',
    'struct Tally { uint256 abstain; uint256 yes; uint256 no; }',
    'struct Action { address to; uint256 value; bytes data; }',
    'struct TargetConfig { address target; uint8 operation; }',

    'function getProposal(uint256 proposalId) view returns (bool open, bool executed, ProposalParameters parameters, Tally tally, Action[] actions, uint256 allowFailureMap, TargetConfig targetConfig)',

    'function vote(uint256 proposalId, Tally _votes, bool _tryEarlyExecution) external',
    // To get the decay configuration
    'function getDecayMidpointBasisPoints() view returns (uint32)',
    // To get the token address
    'function getVotingToken() view returns (address)'
]);

export const ybTokenAbi = parseAbi([
    'function getPastVotes(address account, uint256 timepoint) view returns (uint256)'
]);