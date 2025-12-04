import * as dotenv from "dotenv";
import { FxnCreateProposal } from "./protocols/FxnCreateProposal";

dotenv.config();

const main = async () => {
    await new FxnCreateProposal().job();
};

main().catch(e => console.log(e))

