import { CreateProposal } from "./createProposal";
import axios from "axios";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import { createPublicClient, http } from "viem";
import { CHAIN_ID_TO_RPC, etherscans } from "../../utils/constants";
import { BytesLike, ethers } from "ethers";
import snapshot from "@snapshot-labs/snapshot.js";
import * as dotenv from "dotenv";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";

dotenv.config();

class CakeCreateProposal extends CreateProposal {

    protected canExecute(): boolean {
        return moment().isoWeek() % 2 === 0;
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

        const positionManagerCache: any = {};
        
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
                            const isOldOneYear = (now - createdTimestamp) >= ((30 * 3.5) * 86400)
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

            // Fetch position manager
            if (!positionManagerCache[gauge.chainId]) {
                const { data: positionManager } = await axios.get(`https://configs.pancakeswap.com/api/data/cached/positionManagers?chainId=${gauge.chainId}`);
                positionManagerCache[gauge.chainId] = positionManager;
            }

            let positonManagerName = "";
            const positionManager = positionManagerCache[gauge.chainId];
            if (positionManager) {
                for (const position of positionManager) {
                    if (!position.idByManager || !position.vaultAddress || !position.name) {
                        continue;
                    }

                    const vault_address = position.vaultAddress
                    const id_by_manager = position.idByManager;
                    const name = position.name;

                    if (gauge.address.toLowerCase() === vault_address.toLowerCase()) {
                        positonManagerName = ` ${name}#${id_by_manager}`;
                        break;
                    }
                }
            }

            response.push(`${gauge.pairName} / ${this.getChainIdName(gauge.chainId)}${positonManagerName} - ${this.extractAddress(gauge.address)}`);
        }

        console.log("nb pancake gauge : ", response.length);
        return response;
    }

    protected async vote(receipt: any, gauges: string[]): Promise<void> {
        // Wait 5 minutes to be in the voting window
        await sleep(5 * 60 * 1000);

        const gaugesToVote = [
            {
                gauge: "0xB1D54d76E2cB9425Ec9c018538cc531440b55dbB", // sdcake stable
                weight: 90,
            },
            {
                gauge: "0xa0bec9b22a22caD9D9813Ad861E331210FE6C589", // defiedge sdt-bnb
                weight: 5,
            },
            {
                gauge: "0x1dE329a4ADF92Fd61c24af18595e10843fc307e3", // SDT vault
                weight: 5,
            }
        ];

        const choice = {};
        for (const gaugeToVote of gaugesToVote) {
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
                if (gaugeToVote.gauge.toLowerCase().indexOf(startAddress.toLowerCase()) === -1) {
                    continue;
                }

                choice[(i + 1).toString()] = gaugeToVote.weight;
                break;
            }
        }

        if (Object.keys(choice).length !== gaugesToVote.length) {
            console.log("Impossible to find target Pancake gauges");
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Impossible to find target Pancake gauges`);
            return;
        }

        const hub = process.env.HUB;

        const client = new snapshot.Client712(hub);
        const pk: BytesLike = process.env.VOTE_PRIVATE_KEY;
        const web3 = new ethers.Wallet(pk);

        try {
            await client.vote(web3 as any, web3.address, {
                space: 'sdcake.eth',
                proposal: receipt.id as string,
                type: 'weighted',
                choice,
            });
        }
        catch (e) {
            console.log(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, `Create weekly proposal`, `Can't vote for CAKE proposal - ${e.error_description || e.message || ""}`);
        }
    }
}

new CakeCreateProposal().job();