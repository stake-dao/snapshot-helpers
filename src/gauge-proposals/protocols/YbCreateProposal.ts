import moment from "moment";
import * as dotenv from "dotenv";
import { CreateProposal } from "../createProposal";
import { fetchHubGauges } from "../hubGauges";
import { SD_YB_SPACE } from "../../mirror/spaces";

dotenv.config();

export class YbCreateProposal extends CreateProposal {

    public canExecute(): boolean {
        return moment().isoWeek() % 2 !== 0;
    }

    protected getSpaceNetwork(): string {
        return "ethereum";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(13, 'days');
    }

    protected getLabelTitle(): string {
        return "YB";
    }

    protected getChainId(): string {
        return "1";
    }

    public getSpace(): string {
        return SD_YB_SPACE;
    }

    protected async getGauges(_snapshotBlock: number): Promise<string[]> {
        const gauges = await fetchHubGauges('yb');
        return gauges.map((gauge) => `${gauge.name} - ${gauge.chainId}-${gauge.gauge.toLowerCase()}`);
    }
}
