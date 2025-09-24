import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";

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

        const { data: { chainIds } } = await axios.get("https://api-v2.pendle.finance/core/v1/chains")

        for (const chainId of chainIds) {
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
                        if (gauge.votable === false) {
                            continue;
                        }

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

    
    public async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        // Wait 5 minutes to be in the voting window
        await sleep(1 * 60 * 1000);

        // Push a vote on mainnet from PK for asdPendle
        await this.votePendle(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY, "0xfa19d3a9F73180c9E73D2811e0b66EEED612f728");
    }

    private async votePendle(gauges: string[], proposalId: string, pkStr: string, targetGaugeAddress: string) {

        let choiceIndex = -1;
        for (let i = 0; i < gauges.length; i++) {
            const gauge = gauges[i];

            if (gauge.toLowerCase().indexOf(targetGaugeAddress.toLowerCase()) > -1) {
                choiceIndex = i;
                break;
            }
        }

        if (choiceIndex === -1) {
            const msg = `Impossible to find target gauge. Proposal id : ${proposalId} / target gauge address : ${targetGaugeAddress}`;
            console.log(msg);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, msg);
            return;
        }

        const hub = process.env.HUB;
        const client = new snapshot.Client712(hub);
        const pk: BytesLike = pkStr;
        const web3 = new ethers.Wallet(pk);

        const choice: any = {};
        choice[(choiceIndex + 1).toString()] = 1;

        try {
            await client.vote(web3 as any, web3.address, {
                space: this.getSpace(),
                proposal: proposalId,
                type: 'weighted',
                choice,
            });
        }
        catch (e) {
            console.log(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for PENDLE proposal - ${e.error_description || e.message || ""}`);
        }
    };
}

new PendleCreateProposal().job();