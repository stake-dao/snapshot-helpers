export interface ProposalParams {
  votingMode: number;         // uint8
  supportThreshold: number;   // uint32
  startDate: bigint;          // uint64
  endDate: bigint;            // uint64
  snapshotTimepoint: bigint;  // uint64
  minVotingPower: bigint;     // uint256
}

export interface ProposalTally {
  abstain: bigint;            // uint256
  yes: bigint;                // uint256
  no: bigint;                 // uint256
}

export interface ProposalData {
  isOpen: boolean;
  isExecuted: boolean;
  params: ProposalParams;
  tally: ProposalTally;
}