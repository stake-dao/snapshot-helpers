import * as dotenv from "dotenv";
import { BytesLike, ethers } from "ethers";
import * as proposals from "./proposal.json"; // This import style requires "esModuleInterop", see "side notes"
import snapshot from "@snapshot-labs/snapshot.js";
import { ProposalType } from "@snapshot-labs/snapshot.js/dist/sign/types";

dotenv.config();

async function main() {

  const hub = process.env.HUB;

  const client = new snapshot.Client712(hub);
  const pk: BytesLike = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";

  const signingKey = new ethers.utils.SigningKey(pk);
  const web3 = new ethers.Wallet(signingKey);

  await client.proposal(web3, web3.address, {
    space: proposals.space,
    type: proposals.payload.type as ProposalType,
    title: proposals.payload.name,
    body: proposals.payload.body,
    discussion: proposals.payload.discussion,
    choices: proposals.payload.choices,
    start: proposals.payload.start,
    end: proposals.payload.end,
    snapshot: proposals.payload.snapshot,
    plugins: JSON.stringify({}),
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
