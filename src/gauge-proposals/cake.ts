import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import { createPublicClient, http } from "viem";
import { CHAIN_ID_TO_RPC, etherscans } from "../../utils/constants";

class CakeCreateProposal extends CreateProposal {

    protected canExecute(): boolean {
        return moment().isoWeek() % 2 !== 0;
    }

    protected getSpaceNetwork(): string {
        return "bsc";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(13, 'days');
    }

    protected getLabelTitle(): string {
        return "CAKE";
    }

    protected getChainId(): string {
        return "56";
    }

    protected getSpace(): string {
        return "sdcake.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {
        const data = await axios.get(`https://pancakeswap.finance/api/gauges/getAllGauges?inCap=true&testnet=`);
        const gauges = data.data.data;

        const response: string[] = [];

        const blacklists: string[] = [
            "0x183F325b33d190597D80d1B46D865d0250fD9BF2",
            "0xA2915ae3bc8C6C03f59496B6Dd26aa6a4335b788",
            "0x1A2329546f11e4fE55b853D98Bba2c4678E3105A",
            "0x0db5e247ab73FBaE16d9301f2977f974EC0AA336",
            "0x4cBEa76B4A1c42C356B4c52B0314A98313fFE9df",
            "0xb9dC6396AcFFD24E0f69Dfd3231fDaeB31514D02",
            "0xdb92AD18eD18752a194b9D831413B09976B34AE1",
            "0xBc5Bbf09F1d20724E083E75B92E48073172576f7",
            "0x8b626Acfb32CDad0d2F3b493Eb9928BbA1BbBcCa"
        ];

        // Fetch blocknumbers
        const blockNumbers: Record<number, number> = {};
        for (const etherscan of etherscans) {
            const client = createPublicClient({
                chain: etherscan.chain,
                transport: http(CHAIN_ID_TO_RPC[etherscan.chain.id])
            });

            const currentBlockNumber = await client.getBlockNumber();
            blockNumbers[etherscan.chain.id] = Number(currentBlockNumber)
        }

        const now = moment().unix();

        for (const gauge of gauges) {
            const isBlacklisted = blacklists.find((addr) => addr.toLowerCase() === gauge.address.toLowerCase()) !== undefined;
            if (isBlacklisted) {
                continue;
            }

            // Check if older than one year and weight = 0
            const etherscan = etherscans.find((e) => e.chain.id === gauge.chainId);
            if (etherscan && gauge.weight === '0') {
                try {
                    const { data: resp } = await axios.get(`https://${etherscan.url}/api?module=contract&action=getcontractcreation&contractaddresses=${gauge.address}&apikey=${etherscan.apiKey}`)
                    // Rate limite
                    await sleep(200)
                    if (resp.result?.length > 0) {
                        const txHash = resp.result[0].txHash;

                        const client = createPublicClient({
                            chain: etherscan.chain,
                            transport: http(CHAIN_ID_TO_RPC[etherscan.chain.id])
                        });

                        const transaction = await client.getTransactionReceipt({ hash: txHash });
                        if (transaction) {
                            // On BSC chain, 1 block every 3 seconds
                            const diffBlocks = blockNumbers[etherscan.chain.id] - Number(transaction.blockNumber)
                            const createdTimestamp = now - (Number(diffBlocks) * etherscan.blockPerSec)
                            const isOldOneYear = (now - createdTimestamp) >= ((30 * 8) * 86400)
                            if (isOldOneYear) {
                                // Skip
                                continue;
                            }
                        }
                    }
                }
                catch (e) {

                }
            }

            response.push(gauge.pairName + " / " + this.getChainIdName(gauge.chainId) + " - " + this.extractAddress(gauge.address));
        }

        console.log("nb pancake gauge : ", response.length);
        return response;
    }
}

new CakeCreateProposal().job();