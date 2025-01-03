import { CreateProposal } from "./createProposal";
import request, { gql } from "graphql-request";
import moment from "moment";

class BalCreateProposal extends CreateProposal {

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
        return "BAL";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdbal.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {

        const query = gql`{
            veBalGetVotingList
            {
            id
            address
            chain
            type
            symbol
            gauge {
                address
                isKilled
                relativeWeightCap
                addedTimestamp
                childGaugeAddress
            }
            tokens {
                address
                logoURI
                symbol
                weight
            }
            }
        }`;

        const data = (await request("https://api-v3.balancer.fi/", query)) as any;
        const gauges = data.veBalGetVotingList.filter((item: any) => !item.gauge.isKilled);

        const response: string[] = [];
        for (const gauge of gauges) {
            response.push(gauge.symbol + " - " + this.extractAddress(gauge.gauge.address));
        }

        return response;
    }
}

new BalCreateProposal().job();