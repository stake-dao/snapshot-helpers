import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";

class FxsCreateProposal extends CreateProposal {

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
        return "FXS";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdfxs.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        const data = await axios.get("https://api.frax.finance/v2/gauges");
        const gauges = data.data.gauges;

        const response: string[] = [];
        for (const gauge of gauges) {
            response.push(gauge.name + " - " + this.extractAddress(gauge.address));
        }

        return response;
    }
}

new FxsCreateProposal().job();