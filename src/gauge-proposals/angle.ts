import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";

class AngleCreateProposal extends CreateProposal {

    protected canExecute(): boolean {
        return moment().isoWeek() % 2 !== 0;
    }

    protected getSpaceNetwork(): string {
        return "ethereum";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(13, 'days');
    }

    protected getLabelTitle(): string {
        return "ANGLE";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdangle.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        try {
            const data = await axios.get("https://api.angle.money/v1/dao");
            const gauges = data.data.gauges.list;

            const response: string[] = [];
            for (const gauge of Object.keys(gauges)) {
                if (gauges[gauge].deprecated) {
                    continue;
                }
                response.push(gauges[gauge].name + " - " + this.extractAddress(gauges[gauge].address));
            }

            return response;
        }
        catch (e) {
            return [];
        }
    }
}

new AngleCreateProposal().job();