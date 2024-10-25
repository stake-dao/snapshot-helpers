import { gql, GraphQLClient } from "graphql-request";
import snapshot from "@snapshot-labs/snapshot.js";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import axios from "axios";
import * as dotenv from "dotenv";
import moment from "moment";
import * as momentTimezone from "moment-timezone";
import { sleep } from "./utils/sleep";
import fs from 'fs';
import * as lodhash from 'lodash';
import * as linkify from "linkifyjs";
import CurveVoterABI from './abis/CurveVoter.json';
import CurveUnderlyingVoterABI from './abis/CurveUnderlyingVoter.json';
import AngleGovernorABI from './abis/AngleGovernor.json';
import { createPublicClient, encodeFunctionData, hexToBigInt, http, parseUnits } from "viem";
import * as chains from 'viem/chains'
import { ANGLE_ONCHAIN_SUBGRAPH_URL } from "./utils/constants";
import { sendTgMessage } from "./utils/telegram";

dotenv.config();

const ONE_HOUR = 3600
const DELAY_CURVE = 3 * 24 * ONE_HOUR
const DELAY_OTHERS = 2 * 24 * ONE_HOUR
const DELAY_ONE_DAY = 1 * 24 * ONE_HOUR

const API_TOKEN_SD = process.env.TG_API_KEY;
const TELEGRAM_API = "https://api.telegram.org/bot" + API_TOKEN_SD + "/sendMessage"
const TELEGRAM_CHANNEL_ID = "@StakeDaoTestBots"
const TELEGRAM_GOVERNANCE_ID = "@StakeDaoTestBots"
const CURVE_VOTER = "0x20b22019406Cf990F0569a6161cf30B8e6651dDa"

// Files
const MESSAGES_PATH_FILE = "./data/messages.json";

// ANGLE
const ANGLE_GOVERNOR = "0x748bA9Cd5a5DDba5ABA70a4aC861b2413dCa4436"
const ANGLE_LOCKER = "0xD13F8C25CceD32cdfA79EB5eD654Ce3e484dCAF5"
const ANGLE_VOTER = "0x0E0F27b9d5F2bc742Bf547968d2f07dECBCf1A23"

// Snapshot
const graphqlClient = new GraphQLClient('https://hub.snapshot.org/graphql');
const HUB_CLIENT = 'https://hub.snapshot.org';

const spaces: Record<string, string> = {
    "sdangle.eth": "ANGLE",
    "sdfxs.eth": "FXS",
    "sdcrv.eth": "CRV",
    "sdcrv-gov.eth": "CRV",
    "sdbal.eth": "BAL",
    "sdapw.eth": "Spectra",
    "sdyfi.eth": "YFI",
    "sdpendle.eth": "Pendle",
    "sdmav.eth": "MAV",
    "sdfxn.eth": "FXN",
    "sdcake.eth": "CAKE",
    "sdbpt.eth": "BPT",
}

var originSpaces: Record<string, string> = {
    "sdangle.eth": "anglegovernance.eth",
    "sdfxs.eth": "frax.eth",
    "sdcrv.eth": "curve.eth",
    "sdcrv-gov.eth": "curve.eth",
    "sdbal.eth": "balancer.eth",
    "sdapw.eth": "spectradao.eth",
    "sdyfi.eth": "veyfi.eth",
    "sdpendle.eth": "sdpendle.eth",
    "sdmav.eth": "mavxyz.eth",
    "sdfxn.eth": "fxn.eth",
    "sdcake.eth": "cakevote.eth",
    "sdbpt.eth": "blackpoolhq.eth",
}

interface Proposal {
    id: string;
    title: string;
    body: string;
    choices: string[];
    start: number;
    end: number;
    snapshot: string;
    state: string;
    author: string;
    created: number;
    type: string;
    scores: number[];
    quorum: number;
    network: string;
    space: {
        id: string;
        name: string;
        symbol: string;
    };
}

interface GraphQLResponse {
    proposals: Proposal[];
}

interface AngleProposal {
    id: string;
    description: string;
    snapshotBlock: string;
    snapshotTimestamp: string;
}
interface AngleGraphQLResponse {
    proposals: AngleProposal[];
}

interface IMessage {
    space: string;
    voter: string;
    payload: string;
    text: string;
    votes: string;
    voteId: number;
    votingAddress: string;
    deadline: number;
    type: 'curve' | 'angle';
}

interface IStoredMessages {
    lastSend: number;
    messages: IMessage[];
}

const sendTextToTelegramChat = async (
    proposal: Proposal,
    token: string,
    isReminderTwoHour: boolean,
    isReminderOneDay: boolean,
    isClosed: boolean
) => {
    let intro = `🟢 New ${token} proposal`;

    if (isReminderTwoHour || isReminderOneDay) {
        if (isReminderTwoHour) {
            intro = `🔴 ${token} 2h reminder`;
        } else {
            intro = `🟠 ${token} 24h reminder`;
        }
    }

    let text = '';
    if (isClosed) {
        text = `🔒 ${token} proposal closed: ${proposal.title} (<a href='https://stakedao.org/governance/protocols/${proposal.id}'>link</a>)`;
    } else {
        const endDate = new Date(proposal.end * 1000).toISOString().replace('T', ' ').slice(0, 19); // Convertir en date au format UTC
        text = `${intro}: ${proposal.title}\nEnd Date: ${endDate} UTC (<a href='https://stakedao.org/governance/protocols/${proposal.id}'>link</a>)`;
    }

    try {
        const response = await axios.post(TELEGRAM_API, null, {
            params: {
                chat_id: TELEGRAM_CHANNEL_ID,
                text: text,
                parse_mode: 'html',
                disable_web_page_preview: 'true',
            },
        });
        console.log('Message envoyé avec succès:', response.data);
    } catch (err) {
        console.error('Erreur lors de l\'envoi du message:', err);
    }

    await sleep(1000)
}

const getNewProposals = async (space: string, timePerSpaces: Record<string, number>): Promise<Proposal[]> => {
    let proposals: Proposal[] = [];
    let sec = moment().unix();

    while (true) {
        const query = gql`
        {
          proposals(
            where: {
              space_in: ["${space}"],
              created_lt: ${sec},
              created_gt: ${timePerSpaces[space] || sec}
            },
            orderBy: "created",
            orderDirection: desc,
            first: 1000
          ) {
            id
            title
            body
            choices
            start
            end
            snapshot
            state
            author
            created
            network
            space {
                id
                name
                symbol
            }
          }
        }
      `;

        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);

        // If no more proposals, it's done
        if (graphqlResponse.proposals.length === 0) {
            break;
        }

        proposals = proposals.concat(graphqlResponse.proposals);
        sec = proposals[proposals.length - 1].created;
    }

    if (proposals.length > 0) {
        timePerSpaces[space] = proposals[proposals.length - 1].created;
    }

    return proposals;
}


const getReminder = async (space: string, end: number): Promise<Proposal[]> => {
    
    let proposals: Proposal[] = [];

    // Calcul de l'intervalle de temps pour la requête GraphQL
    const endGt = Math.floor((new Date(end * 1000).getTime() - 15 * 60 * 1000) / 1000); // end - 15 minutes

    // Requête GraphQL
    const query = gql`
      {
        proposals(
          where: {
            space_in: ["${space}"],
            end_lt: ${end},
            end_gt: ${endGt}
          },
          orderBy: "created",
          orderDirection: desc,
          first: 1000
        ) {
          id
          title
          body
          choices
          start
          end
          snapshot
          state
          author
          created
          network
          space {
            id
            name
            symbol
          }
        }
      }
    `;

    try {
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);
        proposals = graphqlResponse.proposals;
    } catch (err) {
        console.error('Erreur lors de la requête GraphQL:', err);
        throw err;
    }

    return proposals;
}

const getClosed = async (space: string): Promise<Proposal[]> => {
    let proposals: Proposal[] = [];

    const now = Math.floor(Date.now() / 1000);
    const fifteenMinutesAgo = now - 15 * 60; // 5 minutes en secondes

    // Requête GraphQL
    const query = gql`
      {
        proposals(
          where: {
            space_in: ["${space}"],
            end_gte: ${fifteenMinutesAgo},
            end_lte: ${now},
            state: "closed"
          },
          orderBy: "created",
          orderDirection: desc,
          first: 1000
        ) {
          id
          title
          body
          choices
          start
          end
          snapshot
          state
          author
          created
          type
          scores
          quorum
          network
          space {
            id
            name
            symbol
          }
        }
      }
    `;

    try {
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);
        proposals = graphqlResponse.proposals;
    } catch (err) {
        console.error('Erreur lors de la requête GraphQL:', err);
        throw err;
    }

    return proposals;
}

const getProposal = async (proposalId: string, space: string): Promise<Proposal> => {

    // Requête GraphQL
    const query = gql`
      {
        proposals(
          where: {
            space_in: ["${space}"],
            id: "${proposalId}"
          },
          orderBy: "created",
          orderDirection: desc,
          first: 1000
        ) {
          id
          title
          body
          choices
          start
          end
          snapshot
          state
          author
          created
          type
          scores
          quorum
          network
          space {
            id
            name
            symbol
          }
        }
      }
    `;

    try {
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(query);
        return graphqlResponse.proposals[0];
    } catch (err) {
        console.error('Erreur lors de la requête GraphQL:', err);
        throw err;
    }
}

const getOriginalProposal = async (proposal: Proposal, space: string): Promise<Proposal | undefined> => {
    const originSpace = originSpaces[space];

    let title = proposal.title;
    if (space.toLowerCase() === "sdyfi.eth") {
        title = title.replaceAll("Gauge vote YFI - ", "");
    }

    const graphqlRequest = gql`
        query {
            proposals(
                where: { space_in: ["${originSpace}"], title_contains: "${title}" },
                orderBy: "created",
                orderDirection: desc,
                first: 1
            ) {
                id
                title
                body
                choices
                start
                end
                snapshot
                state
                author
                created
                type
                network
                space {
                    id
                    name
                    symbol
                }
            }
        }
    `;

    try {
        const graphqlResponse: GraphQLResponse = await graphqlClient.request(graphqlRequest);

        if (graphqlResponse.proposals.length === 0) {
            return undefined;
        }

        return graphqlResponse.proposals[0];
    } catch (err) {
        console.error(err);
        return undefined;
    }
}

const getPctBase = async (votingAddress: string): Promise<number | undefined> => {

    for (let i = 0; i < 3; i++) {
        const publicClient = createPublicClient({
            chain: chains.mainnet,
            transport: http()
        });

        // @ts-ignore
        const response = await publicClient.readContract({
            address: votingAddress as `0x${string}`,
            abi: CurveUnderlyingVoterABI,
            functionName: 'PCT_BASE',
        });

        const pctBase = Number(response) || undefined;
        if (pctBase !== undefined) {
            return pctBase;
        }
    }

    return undefined;
}

const getOriginalAngleProposal = async(proposal: Proposal): Promise<AngleProposal | undefined> => {
    const graphqlClient = new GraphQLClient(ANGLE_ONCHAIN_SUBGRAPH_URL);

    const graphqlRequest = gql`
        query {
            proposals(
                where: { snapshotBlock: ${proposal.snapshot} },
                orderBy: "creationBlock",
                orderDirection: desc,
                first: 1000
            ) {
                id
                description
                snapshotBlock
                snapshotTimestamp
            }
        }
    `;

    try {
        const graphqlResponse: AngleGraphQLResponse = await graphqlClient.request(graphqlRequest);

        if (graphqlResponse.proposals.length === 0) {
            return undefined;
        }

        if (graphqlResponse.proposals.length === 1) {
            return graphqlResponse.proposals[0];
        }

        // Search by description
        for (const originalProposal of graphqlResponse.proposals) {
            const ipfsUrl = originalProposal.description.replace("ipfs://", "ipfs/");

            const response = await fetch(`https://angle-blog.infura-ipfs.io/${ipfsUrl}`);
            if (!response.ok) {
                return undefined;
            }

            const respBody = await response.text();
            const description = respBody.substring(1);

            if (description.toLowerCase() === proposal.title.toLowerCase()) {
                return originalProposal;
            }
        }

        return undefined;
    } catch (err) {
        console.error(err);
        return undefined;
    }
}

const getAngleVotingPower = async (snapshotTimestamp: number): Promise<bigint | undefined> => {
    const publicClient = createPublicClient({
        chain: chains.mainnet,
        transport: http()
    });

    const response = await publicClient.readContract({
        address: ANGLE_GOVERNOR as `0x${string}`,
        abi: AngleGovernorABI,
        functionName: 'getVotes',
        args: [ANGLE_LOCKER, snapshotTimestamp]
      });

    return BigInt(response as any) || undefined;
}

const replicateVote = async (space: string, proposalSD: Proposal, originalProposal: Proposal): Promise<boolean> => {
    try {
        let choice = null;

        if (originalProposal.type === "single-choice" || originalProposal.type === "basic") {
            let bestIndexScore = 0;
            let bestScore = -1;
            for (let i = 0; i < proposalSD.scores.length; i++) {
                if (proposalSD.scores[i] > bestScore) {
                    bestScore = proposalSD.scores[i];
                    bestIndexScore = i + 1;
                }
            }

            choice = bestIndexScore;
        } else {
            choice = {};
            let index = 1;
            for (const score of proposalSD.scores) {
                choice[index.toString()] = score;
                index++;
            }
        }

        let rpcProviderUrl = "";
        let pks: string[] = [];

        if (space === 'sdfxs.eth') {
            rpcProviderUrl = "https://rpc.frax.com";

            // 0x0116Bf9b4614B42c78302Eb2dEB31f2329ec6152 => mainnet
            // 0x7191045aDC32132Ec7766A77f0892797D8282F86 => fraxtal
            pks = [process.env.FRAX_DELEGATION_MAINNET, process.env.FRAX_DELEGATION_FRAXTAL];
        } else {
            rpcProviderUrl = proposalSD.network === "1" ? "https://eth.public-rpc.com" : "https://rpc.ankr.com/bsc";
            pks = [process.env.PK_BOT_REPLICATION];
        }

        const provider = new JsonRpcProvider(rpcProviderUrl);
        const client = new snapshot.Client712(HUB_CLIENT);

        for (const pk of pks) {
            const signer = new Wallet(pk, provider);
            const address = signer.address;

            await client.vote(signer as any, address, {
                space: originalProposal.space.id,
                proposal: originalProposal.id,
                type: originalProposal.type as any,
                choice,
                metadata: JSON.stringify({}),
                reason: 'Stake DAO ' + proposalSD.space.symbol.replace("sd", "") + ' Liquid Locker'
            });
        }

        return true;
    }
    catch (e) {
        console.log(e);
        return false;
    }
}

const sendToOperationsChannel = async (proposal: Proposal, token: string, space: string) => {
    // Skip if proposal is our gauge vote and if it's not YFI (beacause YFI is 100% on snapshot)
    if(space !== "sdyfi.eth" && proposal.title.indexOf("Gauge vote") > -1) {
        return;
    }

    const originSpace = originSpaces[space];
	const isCurveProposal = originSpace == "curve.eth";
	
    let msg: IMessage | undefined = undefined;
    let sendTgAlert = false;
    let isAngleOnChainProposal = false;
    let isOnchainProposal = isCurveProposal;
    let deadline = proposal.end;

    if (originSpace === 'cakevote.eth' || originSpace === 'spectradao.eth') {
        deadline += DELAY_ONE_DAY;
    } else if (originSpace === "curve.eth") {
        deadline += DELAY_CURVE;
    } else {
        deadline += DELAY_OTHERS;
    }	

    let text = "🔒 " + token + " : " + proposal.title.replaceAll("<>", "") + ". <a href='https://snapshot.org/#/" + space + "/proposal/" + proposal.id + "'>Stake DAO</a>\n"

    if (!isOnchainProposal) {
        const originalProposal = await getOriginalProposal(proposal, space)
        if (originalProposal === undefined) {
            isAngleOnChainProposal = true
            isOnchainProposal = true
        } else {
            text += "Snapshot : <a href='https://snapshot.org/#/" + originSpace + "/proposal/" + originalProposal.id + "'>" + originSpace + "</a>\n"
        }
    }

    // Compute results
	const total = proposal.scores.reduce((acc:number, score:number) => acc + score, 0);
	if (total === 0) {
		// Nothing to replicate
        sendTgAlert = true;
		text += "✅ Nothing to replicate"
	} else if (proposal.quorum > total) {
        sendTgAlert = true;
		text += "❌ Not replication because of no quorum\n"
    } else {
        const votes: string[] = [];
        let yea = 0;
        let nay = 0;
        let totalVotes = 0;

        for (let i = 0; i < proposal.scores.length; i++) {
            const score = proposal.scores[i];
            if (score === 0) {
                continue;
            }

            const choice = proposal.choices[i];
            if(choice === "No") {
                nay += score;
            } else if(choice === "Yes") {
                yea += score;
            }

            totalVotes += score;
            
            const percentage = score * 100 / total;

            votes.push(lodhash.round(percentage, 2) + "% " + proposal.choices[i]);
        }

        let replicateDone = false;

        if (isCurveProposal) {
            const links = linkify.find(proposal.body);
            if (links.length > 0) {
                const link = links[0];
                const slashes = link.href.split("/")
                let voteId: number | undefined = undefined;
                if (slashes.length > 0) {
                    voteId = parseInt(slashes[slashes.length - 1]);
                    if (isNaN(voteId)) {
                        voteId = undefined;
                    }
                }

                if (voteId === undefined) {
                    text += "❌ Can't extract vote id\n";
                    sendTgAlert = true;
                } else {
                    let votingAddress = undefined;
                    if (link.value.includes("ownership")) {
                        votingAddress = "0xE478de485ad2fe566d49342Cbd03E49ed7DB3356";
                    } else if (link.value.includes("parameter")) {
                        votingAddress = "0xBCfF8B0b9419b9A88c44546519b1e909cF330399";
                    }

                    // Get PCT_BASE
                    const pctBase = Number(BigInt("1000000000000000000"))// await getPctBase(votingAddress);
                    if (pctBase === undefined) {
                        text += "❌ Error when fetch PCT_BASE\n";
                        sendTgAlert = true;
                    } else {

                        const yeaBN = Math.floor(yea / totalVotes * pctBase);
                        const nayBN = pctBase - yeaBN;

                        const payload = encodeFunctionData({
                            abi: CurveVoterABI,
                            functionName: 'votePct',
                            args: [BigInt(voteId), BigInt(yeaBN), BigInt(nayBN), votingAddress]
                        });

                        msg = {
                            payload,
                            space,
                            text,
                            voteId,
                            voter: CURVE_VOTER,
                            votes: votes.join(","),
                            votingAddress,
                            deadline,
                            type: 'curve',
                        };
                    }
                }
            } else {
                text += "❌ Can't extract http link\n";
                sendTgAlert = true;
            }
        } else if (isAngleOnChainProposal) {
            if (proposal.choices.length === 3) {
                const angleProposal = await getOriginalAngleProposal(proposal);
                if (angleProposal === undefined) {
                    text += "❌ Error when try to fetch original angle proposal \n"
                    sendTgAlert = true;
                } else {
                    const snapshotTimestamp = parseInt(angleProposal.snapshotTimestamp);
                    if (isNaN(snapshotTimestamp)) {
                        text += "❌ Error when try to fetch original angle proposal - convert snapshot timestamp \n"
                        sendTgAlert = true;
                    } else {
                        const votingPower = await getAngleVotingPower(snapshotTimestamp);
                        if(votingPower === undefined) {
                            text += "❌ Error when try to fetch original angle proposal - voting power \n"
                            sendTgAlert = true;
                        } else {

                            let against = parseUnits(proposal.choices[0], 18);
                            let forr = parseUnits(proposal.choices[1], 18);
                            let abstain = parseUnits(proposal.choices[2], 18);

                            const total = against + forr+abstain;

                            const percentageAgainst = against * BigInt(100) / total;
                            const percentageForr = forr * BigInt(100) / total;
                            const percentageAbstain = abstain * BigInt(100) / total;

                            against = percentageAgainst * votingPower / BigInt(100);
                            forr = percentageForr * votingPower / BigInt(100);
                            abstain = percentageAbstain * votingPower / BigInt(100);

                            const id = hexToBigInt(angleProposal.id as `0x${string}`, { size: 32 })

                            const payload = encodeFunctionData({
                                abi: AngleGovernorABI,
                                functionName: 'castVoteWithReasonAndParams',
                                args: [id, BigInt(0), "",  against, forr, abstain]
                            });

                            msg = {
                                payload,
                                space,
                                text,
                                voteId: 0,
                                voter: ANGLE_VOTER,
                                votes: votes.join(","),
                                votingAddress: "",
                                deadline,
                                type: 'angle'
                            };
                        }
                    }
                }
            } else {
                text += "❌ should have 3 choices \n"
                sendTgAlert = true;
            }
        } else {
            sendTgAlert = true;
            const originalProposal = await getOriginalProposal(proposal, space)
            if(originalProposal === undefined) {
                text += "❌ can't fetch original proposal \n"
            } else {
                for (let i = 0; i < 10; i++) {
                    const success = await replicateVote(space, proposal, originalProposal);
                    if (success) {
                        replicateDone = true;
                        break;
                    }
                }
            }

            text += "Vote : (" + votes.join(",") + ") : "
			if (originalProposal !== undefined) {
				text += "<a href='https://snapshot.org/#/" + originSpace + "/proposal/" + originalProposal.id + "'>" + originSpace + "</a>\n"
			} else {
				text += "<a href='https://snapshot.org/#/" + originSpace + "'>" + originSpace + "</a>\n"
			}
        }

        text += "Deadline : " + moment.unix(deadline).format("LLL") + " @chago0x @hubirb\n"

		if (!isOnchainProposal) {
			if (replicateDone) {
				text += "✅ Vote replication done"
			} else {
				text += "❌ Vote replication failed"
			}
		}
    }

    if(msg) {
        // Store msg
        await addMsg(msg);
    }

    if (sendTgAlert) {
        if (await sendTgMessage(API_TOKEN_SD, TELEGRAM_GOVERNANCE_ID, text)) {
            console.log('Message envoyé avec succès');
        } else {
            console.error('Erreur lors de l\'envoi du message');
        }
    }

    await sleep(1000)
}

const addMsg = async (msg: IMessage) => {
    const storedMessages = await readStoredMessages();
    storedMessages.messages.push(msg);
    fs.writeFileSync(MESSAGES_PATH_FILE, JSON.stringify(storedMessages), { encoding: 'utf-8' });
}

const readStoredMessages = async (): Promise<IStoredMessages> => {
    let storedMessages: IStoredMessages = {
        lastSend:  moment().tz('Europe/Paris').startOf("day").unix(),
        messages: []
    };

    if (fs.existsSync(MESSAGES_PATH_FILE)) {
        storedMessages = JSON.parse(fs.readFileSync(MESSAGES_PATH_FILE, { encoding: 'utf-8' }));
    }

    return storedMessages;
}

const sendStoredMessages = async () => {
    const storedMessages = await readStoredMessages();
    const lastSend = momentTimezone.unix(storedMessages.lastSend).tz('Europe/Paris');
    
    const newSend = lastSend.clone().tz('Europe/Paris').add(1, 'days').set("hour", 9).set("minute", 0).set("second", 0);

    const currentUnix = moment().tz('Europe/Paris').unix();
    if(newSend.unix() > currentUnix) {
        return;
    }

    if (storedMessages.messages.length > 0) {
        // Send messages
        let text = "";
        for (const message of storedMessages.messages) {
            text += message.text;

            switch (message.type) {
                case 'curve':
                    text += "Vote id : " + message.voteId + "\n"
                    text += "Voter : " + message.voter + "\n"
                    text += "Voting address : " + message.votingAddress + "\n"
                    break;
                case 'angle':
                    text += "Angle voter V5 : " + message.voter + "\n"
                    break;
                default:
                    break;
            }

            text += "Payload : " + message.payload + "\n"
            text += "Vote : (" + message.votes + ")\n"
            text += "Deadline : " + moment.unix(message.deadline).format("LLL") + " @chago0x @hubirb\n"
            text += "\n"
        }

        if (await sendTgMessage(API_TOKEN_SD, TELEGRAM_GOVERNANCE_ID, text)) {
            console.log('Message envoyé avec succès');
        } else {
            console.error('Erreur lors de l\'envoi du message');
        }
    }

    storedMessages.lastSend = newSend.unix();
    fs.writeFileSync(MESSAGES_PATH_FILE, JSON.stringify(storedMessages), { encoding: 'utf-8' });
}

interface ProposalFetched {
    id: string;
    ts: number;
}

const main = async () => {

    const proposalsFetched: ProposalFetched[][] = JSON.parse(fs.readFileSync("./data/replication_proposals.json", { encoding: 'utf-8' }));
    const timePerSpaces: Record<string, number> = JSON.parse(fs.readFileSync("./data/replication.json", { encoding: 'utf-8' }));
    const now = moment().unix();
    const ens = Object.keys(spaces);

    for (const space of ens) {
        if (!timePerSpaces[space]) {
            timePerSpaces[space] = now;
        }
    }

    // Check if we have new proposals
    for (const space of ens) {
        const newProposals = await getNewProposals(space, timePerSpaces);
        for (const newProposal of newProposals) {
            await sendTextToTelegramChat(newProposal, spaces[space], false, false, false);
        }
    }

    // Check reminders
    let reminderTimestamp = moment.unix(now).add(2, "h").unix()
    for (const space of ens) {
        const proposals = await getReminder(space, reminderTimestamp);
        for (const proposal of proposals) {
            if (proposalsFetched[0].find((p) => p.id.toLowerCase() === proposal.id.toLowerCase())) {
                continue;
            }
            await sendTextToTelegramChat(proposal, spaces[space], true, false, false);
            proposalsFetched[0].push({
                id: proposal.id,
                ts: now,
            });
        }
    }

    reminderTimestamp = moment.unix(now).add(1, "d").unix()
    for (const space of ens) {
        const proposals = await getReminder(space, reminderTimestamp);
        for (const proposal of proposals) {
            if (proposalsFetched[1].find((p) => p.id.toLowerCase() === proposal.id.toLowerCase())) {
                continue;
            }
            await sendTextToTelegramChat(proposal, spaces[space], false, true, false);
            proposalsFetched[1].push({
                id: proposal.id,
                ts: now,
            });
        }
    }
   
    // Check closed
    for (const space of ens) {
        const proposals = await getClosed(space);
        for (const proposal of proposals) {
            if (proposalsFetched[2].find((p) => p.id.toLowerCase() === proposal.id.toLowerCase())) {
                continue;
            }
            await sendTextToTelegramChat(proposal, spaces[space], false, false, true);
            await sendToOperationsChannel(proposal, spaces[space], space);
            proposalsFetched[2].push({
                id: proposal.id,
                ts: now,
            });
        }
    }

    // Change timestamp for the next run
    for (const space of ens) {
        timePerSpaces[space] = now;
    }

    // Clear proposals fetched
    const twoDaysAgo = now - ONE_HOUR * 24 * 2;
    const newProposalFetched: ProposalFetched[][] = [];
    newProposalFetched.push(proposalsFetched[0].filter((p) => p.ts > twoDaysAgo));
    newProposalFetched.push(proposalsFetched[1].filter((p) => p.ts > twoDaysAgo));
    newProposalFetched.push(proposalsFetched[2].filter((p) => p.ts > twoDaysAgo));

    fs.writeFileSync("./data/replication.json", JSON.stringify(timePerSpaces), {encoding: 'utf-8'});
    fs.writeFileSync("./data/replication_proposals.json", JSON.stringify(newProposalFetched), {encoding: 'utf-8'});

    // Check if we have to send our stored messages
    await sendStoredMessages();
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});