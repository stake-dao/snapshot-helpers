import snapshot from "@snapshot-labs/snapshot.js";
import { BytesLike, ethers } from "ethers";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import axios from "axios";
import moment from "moment";
import * as momentTimezone from "moment-timezone";
import * as chains from 'viem/chains'
import * as dotenv from "dotenv";
import request from "graphql-request";
import { SNAPSHOT_URL } from "../mirror/request";
import { QUERY_BY_ID } from "../mirror/snapshotUtils";
dotenv.config();

export abstract class CreateProposal {

    protected readonly SEP_DOT = "…";
    protected readonly SEP_START_ADDRESS = "- 0x";
    private readonly MAX_CHOICES = 1000;

    public async job() {
        try {
            if (!this.canExecute()) {
                console.log("Can't execute the script");
                return;
            }

            const space = this.getSpace();
            const now = moment().utc();
            const thursday = moment(now).startOf('week').add(4, 'days');
            const blockTimestamp =  thursday.set('hours', 2).set('minute', 0).set('second', 0).set('millisecond', 0);
            const startTimestamp = blockTimestamp.unix();
            const endTimestamp = momentTimezone.unix(startTimestamp).tz('Europe/Paris').add(5, "days").set('hours', 16).set('minute', 0).set('second', 0).set('millisecond', 0).unix();

            const snapshotBlock = await this.getBlockByTimestamp(this.getSpaceNetwork(), startTimestamp);
            const gauges = await this.getGauges(snapshotBlock);

            if (gauges.length === 0) {
                console.log("Zero gauge fetched");
                return;
            }

            if (gauges.length > this.MAX_CHOICES) {
                await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space : ${this.getSpace()}\nMore than ${this.MAX_CHOICES} choices (got ${gauges.length} choices)`);
                return;
            }

            // Get start / end proposal dates to generate the title
            const startProposalDate = moment(thursday).add(7, "days");
            const endProposalDate = this.getEndProposalTimestamp(startProposalDate);

            const day = startProposalDate.date();
            const month = startProposalDate.month() + 1;
            const year = startProposalDate.year();

            const dayEnd = endProposalDate.date();
            const monthEnd = endProposalDate.month() + 1;
            const yearEnd = endProposalDate.year();

            const label = this.getLabelTitle()
            const network = this.getChainId();

            const proposal = {
                space: space,
                type: "weighted",
                title: `Gauge vote ${label} - ${day}/${month}/${year} - ${dayEnd}/${monthEnd}/${yearEnd}`,
                body: `Gauge vote for ${label} inflation allocation.`,
                discussion: "",
                choices: gauges,
                start: startTimestamp,
                end: endTimestamp,
                snapshot: snapshotBlock,
                plugins: JSON.stringify({}),
                metadata: {
                    network
                },
            } as any;

            const receipt = await this.createProposal(proposal);
            await this.vote(receipt, gauges);
        }
        catch (e) {
            console.error(e);
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Mirror", `Space : ${this.getSpace()}\n${e.error_description || e.message || ""}`);
        }

        process.exitCode = 0;
    }

    protected extractAddress(address: string): string {
        return address.substring(0, 17) + this.SEP_DOT + address.substring(address.length - 2);
    }

    /**
     * Get the chain name
     * @param chainId chain id
     * @returns Chain name
     */
    protected getChainIdName(chainId: number): string {
        for (const chain of Object.values(chains)) {
            if ('id' in chain) {
                if (chain.id === chainId) {
                    return chain.name;
                }
            }
        }

        return chainId.toString();
    }

    /**
     * Get the viem chain
     * @param chainId Chain id
     * @returns Chain
     */
    protected getChain(chainId: number): chains.Chain | undefined {
        for (const chain of Object.values(chains)) {
            if ('id' in chain) {
                if (chain.id === chainId) {
                    return chain;
                }
            }
        }

        return undefined;
    }

    /**
     * Create the snapshot proposal
     * @param proposal Proposal to create
     * @returns Proposal created
     */
    private async createProposal(proposal: any): Promise<any> {
        const hub = process.env.HUB;
        const client = new snapshot.Client(hub);
        const pk: BytesLike = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";

        const signingKey = new ethers.utils.SigningKey(pk);
        const web3 = new ethers.Wallet(signingKey);

        return await client.proposal(web3 as any, web3.address, proposal) as any;
    }

    /**
     * Fetch a block number from a timestamp
     * @param network chain
     * @param timestamp timestamp
     * @returns block number
     */
    private async getBlockByTimestamp(network: string, timestamp: number): Promise<number> {
        const data = await axios.get("https://coins.llama.fi/block/" + network + "/" + timestamp);
        return data.data.height;
    }

    /**
     * Indicate if we can create the proposal or not
     * Mainly based on the current timestamp
     * ie : weekly, 2 times per week ...
     */
    protected abstract canExecute(): boolean;

    /**
     * Return all gauges as strings
     */
    protected abstract getGauges(snapshotBlock: number): Promise<string[]>;

    /**
     * Return the network associated to the snapshot space
     * ie : ethereum / bsc ...
     */
    protected abstract getSpaceNetwork(): string;

    /**
     * Return the snapshot space
     * ie : sdcrv.eth
     */
    protected abstract getSpace(): string;

    /**
     * Get the proposal end timestamp 
     * @param startProposalTimestamp 
     * @returns 
     */
    protected abstract getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment;

    /**
     * Get the spac label to integrate in the proposal title
     */
    protected abstract getLabelTitle(): string;

    /**
     * Get the space chain id 
     */
    protected abstract getChainId(): string;

    /**
     * For the auto voter, vote based on the proposal id
     * @param receipt Proposal created
     */
    protected async vote(receipt: any, gauges: string[], waitSleep?: boolean): Promise<void> {
        return Promise.resolve();
    }

    private async manualVote(proposalId: string): Promise<void> {
        const result = (await request(`${SNAPSHOT_URL}/graphql`, QUERY_BY_ID, {
            id: proposalId
        })) as any;

        const proposal = result.proposals[0];
        await this.vote(proposal, proposal.choices, false);
    }
}