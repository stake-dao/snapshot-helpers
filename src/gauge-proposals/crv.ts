import * as dotenv from "dotenv";
import { CrvCreateProposal } from "./protocols/CrvCreateProposal";

dotenv.config();

const main = async () => {
    await new CrvCreateProposal().job();
};

main().catch(e => console.log(e))

