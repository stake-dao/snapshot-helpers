import { CreateProposal } from "./createProposal";
import request, { gql } from "graphql-request";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";

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

    protected async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        // Wait 5 minutes to be in the voting window
        if (waitSleep) {
            await sleep(5 * 60 * 1000);
        }

        const gaugesToVote = [
            {
                gauge: "B-sdBAL-STABLE - 0xdc2df969ee5e662…f2",
                weight: 100,
            }
        ];

        const choice = {};
        for (const gaugeToVote of gaugesToVote) {
            for (let i = 0; i < gauges.length; i++) {
                const gauge = gauges[i];
                if (gauge.toLowerCase() !== gaugeToVote.gauge.toLowerCase()) {
                    continue;
                }

                choice[(i + 1).toString()] = gaugeToVote.weight;
                break;
            }
        }

        if (Object.keys(choice).length !== gaugesToVote.length) {
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Impossible to find target Balancer gauges`);
            return;
        }

        const hub = process.env.HUB;

        const client = new snapshot.Client712(hub);
        const pk: BytesLike = process.env.VOTE_PRIVATE_KEY;
        const web3 = new ethers.Wallet(pk);

        try {
            await client.vote(web3 as any, web3.address, {
                space: this.getSpace(),
                proposal: receipt.id as string,
                type: 'weighted',
                choice,
            });
        }
        catch (e) {
            console.log(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for BAL proposal - ${e.error_description || e.message || ""}`);
        }
    }
}

new BalCreateProposal().job();