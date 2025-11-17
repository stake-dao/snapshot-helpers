import * as dotenv from "dotenv";
import { YbCreateProposal } from "./protocols/YbCreateProposal";

dotenv.config();

const main = async () => {
    await new YbCreateProposal().job();
};

main().catch(e => console.log(e))

