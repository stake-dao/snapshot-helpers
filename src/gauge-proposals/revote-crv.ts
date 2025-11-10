import * as dotenv from "dotenv";
import { CrvCreateProposal } from "./protocols/CrvCreateProposal";
import { fetchSDProposal } from "../mirror/request";

dotenv.config();

const main = async () => {
    const obj = new CrvCreateProposal();
    if (!obj.canExecute()) {
        return;
    }

    // Fetch proposals
    const proposals = await fetchSDProposal({ space: obj.getSpace() });
    if (proposals.length === 0) {
        return;
    }

    const proposal = proposals[0];
    
    // Vote
    await obj.manualVote(proposal.id);
};

main().catch(e => console.log(e))

