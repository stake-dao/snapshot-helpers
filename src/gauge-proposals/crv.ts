import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { CreateProposal } from "./createProposal";
import axios from "axios";
import * as chains from 'viem/chains'
import { CHAIN_ID_TO_RPC, CURVE_API, CURVE_GC, etherscans } from "../../utils/constants";
import * as lodhash from 'lodash';
import { sleep } from "../../utils/sleep";
import moment from "moment";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

class CrvCreateProposal extends CreateProposal {

    private readonly SDCRV_CRV_GAUGE = "0x26f7786de3e6d9bd37fcf47be6f2bc455a21b74a"
    private readonly ARBITRUM_VSDCRV_GAUGE = "0xf1bb643f953836725c6e48bdd6f1816f871d3e07";
    private readonly POLYGON_VSDCRV_GAUGE = "0x8ad6f98184a0cb79887244b4e7e8beb1b4ba26d4";

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
        return "CRV";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdcrv.eth";
    }

    protected async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        // Wait 5 minutes to be in the voting window
        await sleep(5 * 60 * 1000);

        // Push a vote on mainnet from PK for sdCRV/CRV gauge
        await this.voteCRV(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY, this.SDCRV_CRV_GAUGE);
        await this.voteCRV(gauges, receipt.id as string, process.env.ARBITRUM_VOTE_PRIVATE_KEY, this.ARBITRUM_VSDCRV_GAUGE);
        await this.voteCRV(gauges, receipt.id as string, process.env.POLYGON_VOTE_PRIVATE_KEY, this.POLYGON_VSDCRV_GAUGE);
    }


    private async voteCRV (gauges: string[], proposalId: string, pkStr: string, targetGaugeAddress: string) {

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
        const data = await axios.get(`${CURVE_API}/api/getAllGauges`);
        const gaugesMap = data.data.data;

        const publicClient = createPublicClient({
            chain: chains.mainnet,
            transport: http(CHAIN_ID_TO_RPC[1])
        });

        const gcAbi = parseAbi([
            'function gauge_types(address gauge) external view returns(int128)',
            'function get_gauge_weight(address gauge) external view returns(uint256)',
        ]);

        const gaugesKeys = Object.keys(gaugesMap);
        const calls: any[] = [];
        const callsHistoricalWeights: any[] = [];
        for (const key of gaugesKeys) {
            if (gaugesMap[key].is_killed) {
                continue;
            }

            const gaugeRoot = gaugesMap[key].rootGauge || gaugesMap[key].gauge;

            calls.push({
                address: CURVE_GC,
                abi: gcAbi,
                functionName: 'gauge_types',
                args: [gaugeRoot]
            });
            calls.push({
                address: CURVE_GC,
                abi: gcAbi,
                functionName: 'get_gauge_weight',
                args: [gaugeRoot]
            });
            callsHistoricalWeights.push({
                address: CURVE_GC,
                abi: gcAbi,
                functionName: 'get_gauge_weight',
                args: [gaugeRoot]
            });
        }

        let results: any[] = [];
        let chunks = lodhash.chunk(calls, 50);
        for (const c of chunks) {
            // @ts-ignore
            const res = await (publicClient.multicall({ contracts: c as any }) as any);
            results = results.concat(res);
        }

        let resultsHistoricalWeights: any[][] = [];
        chunks = lodhash.chunk(callsHistoricalWeights, 50);

        const nbCheck = 10;
        const lastBlock = snapshotBlock - (2 * 365 * 7200);
        const pas = (snapshotBlock - lastBlock) / nbCheck;
        for (let i = 0; i < nbCheck; i++) {
            const _blockNumber = lastBlock + (i * pas);
            resultsHistoricalWeights[i] = [];
            for (const c of chunks) {
                // @ts-ignore
                const res = await (publicClient.multicall({ contracts: c as any, blockNumber: _blockNumber }) as any);
                resultsHistoricalWeights[i] = resultsHistoricalWeights[i].concat(res);
            }
        }

        const etherscan = etherscans.find((etherscan) => etherscan.chain === chains.mainnet);
        const now = moment().unix();

        const response: string[] = [];
        for (const key of gaugesKeys) {
            if (gaugesMap[key].is_killed) {
                continue;
            }

            const gaugeAdded = results.shift()?.error === undefined;
            const gaugeWeight = results.shift();

            let nbHistoricalWeightsToZero = 0;
            for (let i = 0; i < nbCheck; i++) {
                const gaugeHistoricalWeight = resultsHistoricalWeights[i].shift();
                if (gaugeHistoricalWeight.status === 'success') {
                    const hgw = parseFloat(formatUnits(gaugeHistoricalWeight?.result, 18));
                    if (hgw === 0) {
                        nbHistoricalWeightsToZero++;
                    }
                }
            }

            if (!gaugeAdded) {
                continue;
            }

            if (gaugeWeight.status === 'success') {
                const gw = parseFloat(formatUnits(gaugeWeight?.result, 18));
                if (gw === 0) {
                    // Check age
                    /*try {
                        
                        if (etherscan) {
                            const gaugeRoot = gaugesMap[key].rootGauge || gaugesMap[key].gauge;

                            const url = `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getcontractcreation&contractaddresses=${gaugeRoot}&apikey=${etherscan.apiKey}`;
                            const { data: resp } = await axios.get(url);
                            // Rate limite
                            await sleep(200)
                            if (resp.result?.length > 0) {
                                const createdTimestamp = parseInt(resp.result[0].timestamp);
                                const isOldTwoYears = (now - createdTimestamp) >= (((2 * 365)) * 86400)
                                if (isOldTwoYears) {
                                    // Skip
                                    continue;
                                }
                            }
                        }

                    }
                    catch (e) {
                        console.log(gaugesMap[key].rootGauge || gaugesMap[key].gauge, e)
                    }*/
                }
            }

            const gauge = gaugesMap[key].gauge as string;
            response.push(key + " - " + this.extractAddress(gauge));
        }

        return response;
    }
}

new CrvCreateProposal().job();