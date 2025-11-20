import axios from "axios";
import moment from "moment";
import * as dotenv from "dotenv";
import { CreateProposal } from "../createProposal";

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
        return "sd-yieldbasis.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        // Using native fetch to get gauges data
        const response = await fetch(`https://api-v2.stakedao.org/yb/gauges`);

        // Fetch does not throw an error for non-200 status codes automatically, so we check it manually
        if (!response.ok) {
            throw new Error(`Failed to fetch gauges: ${response.statusText}`);
        }

        const data = await response.json();

        const responses: string[] = [];

        for (const gauge of data.gauges) {
            responses.push(`${gauge.name} - ${gauge.chainId}-${gauge.gauge.toLowerCase()}`);
        }
        
        return responses;
    }
}