import { CreateProposal } from "./createProposal";
import moment from "moment";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";
import { gql, GraphQLClient } from "graphql-request";
import { GraphQLResponse } from "../replication/interfaces/graphql";

class YFICreateProposal extends CreateProposal {

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
        return "YFI";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdyfi.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        return []
    }

    public async sdYFIVote(): Promise<void> {

        const gaugesToVote = [
            {
                gauge: "sdYFI/YFI yVault",
                weight: 100,
            }
        ];

        const query = gql`
        {
            proposals(
            where: {
                space_in: ["${this.getSpace()}"],
                type: "weighted"
                title_contains: "Gauge vote YFI - Epoch"
            },
            orderBy: "created",
            orderDirection: desc,
            first: 1
            ) {
                id
                choices
                state
            }
        }
        `;
        const graphqlClient = new GraphQLClient('https://hub.snapshot.org/graphql');
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);

        // If no more proposals, it's done
        if (graphqlResponse.proposals.length === 0) {
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Impossible to find target YFI gauges`);
            return
        }

        const proposal = graphqlResponse.proposals[0];
        if (proposal.state === "closed") {
            console.log(`sdYFI gauge proposal ${proposal.id} is closed`)
            return;
        }

        const choice = {};
        for (const gaugeToVote of gaugesToVote) {
            for (let i = 0; i < proposal.choices.length; i++) {
                const gauge = proposal.choices[i];
                if (gauge.toLowerCase() !== gaugeToVote.gauge.toLowerCase()) {
                    continue;
                }

                choice[(i + 1).toString()] = gaugeToVote.weight;
                break;
            }
        }

        if (Object.keys(choice).length !== gaugesToVote.length) {
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Impossible to find target YFI gauges`);
            return;
        }

        const hub = process.env.HUB;

        const client = new snapshot.Client712(hub);
        const pk: BytesLike = process.env.VOTE_PRIVATE_KEY;
        const web3 = new ethers.Wallet(pk);

        try {
            await client.vote(web3 as any, web3.address, {
                space: this.getSpace(),
                proposal: proposal.id,
                type: 'weighted',
                choice,
            });
        }
        catch (e) {
            console.log(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for YFI proposal - ${e.error_description || e.message || ""}`);
        }
    }
}

new YFICreateProposal().sdYFIVote();