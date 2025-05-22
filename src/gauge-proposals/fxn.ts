import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";
import { sleep } from "../../utils/sleep";

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

    protected async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        // Wait 5 minutes to be in the voting window
        if (waitSleep) {
            await sleep(5 * 60 * 1000);
        }

        const gaugesToVote = [
            {
                gauge: "FXN+sdFXN - 0x5b1D12365BEc01b…ba",
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
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Impossible to find target FXN gauges`);
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
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for FXN proposal - ${e.error_description || e.message || ""}`);
        }
    }
}

new FxnCreateProposal().job();