import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import { CHAIN_IDS } from "../../utils/chainIds";

class PendleCreateProposal extends CreateProposal {

    protected canExecute(): boolean {
        return true;
    }

    protected getSpaceNetwork(): string {
        return "ethereum";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(6, 'days');
    }

    protected getLabelTitle(): string {
        return "PENDLE";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdpendle.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {

        const SIZE = 100;
        const response: string[] = [];

        for (const chainId of Object.keys(CHAIN_IDS)) {
            let run = true;
            let skip = 0;

            let countChain = 0;
            do {
                try {
                    countChain++;
                    if (countChain === 80) {
                        await sleep(2 * 1000); // Sleep 2s to avoid rate limit from Pendle
                        countChain = 0;
                    }
                    const data = await axios.get(`https://api-v2.pendle.finance/core/v1/${chainId}/markets?limit=${SIZE}&is_expired=false&skip=${skip}`);

                    const gauges = data.data.results;

                    if (gauges.length === SIZE) {
                        skip += SIZE;
                    } else {
                        run = false;
                    }

                    for (const gauge of gauges) {
                        let name = gauge.pt.name;
                        if (name.indexOf("PT ") > -1) {
                            name = name.replace("PT ", "");
                        }
                        if (name.indexOf("PT-") > -1) {
                            name = name.replace("PT-", "");
                        }
                        response.push(name + " - " + gauge.pt.chainId + "-" + gauge.address);
                    }
                }
                catch (e) {
                    run = false;
                }
            }
            while (run);
        }

        return response;
    }
}

new PendleCreateProposal().job();