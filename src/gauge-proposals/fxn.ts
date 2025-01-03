import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";

class FxnCreateProposal extends CreateProposal {

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
        return "FXN";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdfxn.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        const data = await axios.get("https://api.aladdin.club/api1/get_fx_gauge_list");
        const gaugesMap = data.data.data;

        const response: string[] = [];
        for (const key of Object.keys(gaugesMap)) {
            const gauge = gaugesMap[key].gauge as string;
            const name = gaugesMap[key].name as string;
            response.push(name + " - " + this.extractAddress(gauge));
        }

        return response;
    }
}

new FxnCreateProposal().job();