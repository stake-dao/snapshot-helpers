import { isAddress } from "viem";
import * as chains from 'viem/chains'
import moment from "moment";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";
import * as dotenv from "dotenv";
import { CreateProposal } from "../createProposal";
import { sleep } from "../../../utils/sleep";
import { CHAT_ID_ERROR, sendMessage } from "../../../utils/telegram";

dotenv.config();

export class CrvCreateProposal extends CreateProposal {

    private readonly SDCRV_CRV_GAUGE = "0x26f7786de3e6d9bd37fcf47be6f2bc455a21b74a"
    private readonly ARBITRUM_VSDCRV_GAUGE = "0xf1bb643f953836725c6e48bdd6f1816f871d3e07";
    private readonly POLYGON_VSDCRV_GAUGE = "0x8ad6f98184a0cb79887244b4e7e8beb1b4ba26d4";

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
        return "CRV";
    }

    protected getChainId(): string {
        return "1";
    }

    public getSpace(): string {
        return "sdcrv.eth";
    }

    protected async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        // Wait 5 minutes to be in the voting window
        if (waitSleep) {
            await sleep(5 * 60 * 1000);
        }

        // Push a vote on mainnet from PK for sdCRV/CRV gauge
        await this.voteCRV(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY, this.SDCRV_CRV_GAUGE);
        await this.voteCRV(gauges, receipt.id as string, process.env.ARBITRUM_VOTE_PRIVATE_KEY, this.ARBITRUM_VSDCRV_GAUGE);
        //await this.voteCRV(gauges, receipt.id as string, process.env.POLYGON_VOTE_PRIVATE_KEY, this.POLYGON_VSDCRV_GAUGE);
    }


    private async voteCRV(gauges: string[], proposalId: string, pkStr: string, targetGaugeAddress: string) {

        let choiceIndex = -1;
        for (let i = 0; i < gauges.length; i++) {
            const gauge = gauges[i];
            const startIndex = gauge.indexOf(this.SEP_START_ADDRESS);
            if (startIndex === -1) {
                continue;
            }

            const endIndex = gauge.indexOf(this.SEP_DOT, startIndex);
            if (endIndex === -1) {
                continue;
            }

            const startAddress = gauge.substring(startIndex + this.SEP_START_ADDRESS.length - 2, endIndex);
            if (targetGaugeAddress.toLowerCase().indexOf(startAddress.toLowerCase()) === -1) {
                continue;
            }

            choiceIndex = i;
            break;
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
                space: 'sdcrv.eth',
                proposal: proposalId,
                type: 'weighted',
                choice,
            });
        }
        catch (e) {
            console.log(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for CRV proposal - ${e.error_description || e.message || ""}`);
        }
    };

    protected async getGauges(snapshotBlock: number): Promise<string[]> {

        // Using native fetch to get gauges data
        const [gaugesResponse, chainlistResponse] = await Promise.all([
            fetch("https://votemarket-api.contact-69d.workers.dev/curve/gauges"),
            fetch("https://chainlist.org/rpcs.json")
        ])


        // Fetch does not throw an error for non-200 status codes automatically, so we check it manually
        if (!gaugesResponse.ok) {
            throw new Error(`Failed to fetch gauges: ${gaugesResponse.statusText}`);
        }
        if (!chainlistResponse.ok) {
            throw new Error(`Failed to fetch chainlist: ${chainlistResponse.statusText}`);
        }

        const data = await gaugesResponse.json();
        const chainlist = await chainlistResponse.json();

        const responses: string[] = [];

        const gaugesNotKilled = data.gauges.filter((g) => g.isKilled === false);

        for (const gauge of gaugesNotKilled) {
            let pool = gauge.pool;
            if (isAddress(pool)) {
                pool = `${pool.substring(0, 6)}${this.SEP_DOT}${pool.substring(pool.length-4)}`
            }

            let chainName = "";
            if (gauge.chainId !== chains.mainnet.id) {
                chainName = chainlist.find((chain) => chain.isTestnet === false && chain.chainId === gauge.chainId)?.chainSlug || "";
                chainName = `${chainName}`
            }

            const childGauge = gauge.childGauge || "";
            const gaugeExtractedAddress = this.extractAddress(childGauge.length > 0 ? childGauge : gauge.gauge);

            if (gauge.name.indexOf("Lending") > -1) {
                const chainDetails = chainName.length > 0 ? `[${chainName}] ` : "";
                const collateralName = gauge.coins.find((coin) => coin.symbol !== "crvUSD")?.symbol || "";

                responses.push(`${chainDetails}Lending: Borrow crvUSD (${collateralName} collateral) (${pool}) - ${gaugeExtractedAddress.toLowerCase()}`);
            } else {
                let shortName = gauge.coins.map((coin) => coin.symbol).join("+");
                /*let shortName = gauge.shortName;
                let index = shortName.indexOf(" ");
                if (index > -1) {
                    shortName = shortName.substring(0, index).trim();
                }*/
                

                if(chainName.length > 0) {
                    chainName = `${chainName}-`

                    const indexDash = shortName.indexOf("-")
                    if(indexDash > -1) {
                       // shortName = shortName.substring(indexDash + 1)
                    }
                }

                responses.push(`${chainName}${shortName} (${pool}) - ${gaugeExtractedAddress.toLowerCase()}`);
            }
        }

        return responses;
    }
}