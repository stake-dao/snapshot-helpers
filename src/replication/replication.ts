import { gql, GraphQLClient } from "graphql-request";
import snapshot from "@snapshot-labs/snapshot.js";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import axios from "axios";
import * as dotenv from "dotenv";
import moment from "moment";
import { sleep } from "../../utils/sleep";
import fs from 'fs';
import * as lodhash from 'lodash';
import * as linkify from "linkifyjs";
import CurveVoterABI from '../../abis/CurveVoter.json';
import AngleGovernorABI from '../../abis/AngleGovernor.json';
import { createPublicClient, encodeFunctionData, hexToBigInt, http, parseUnits } from "viem";
import * as chains from 'viem/chains'
import { ANGLE_ONCHAIN_SUBGRAPH_URL, CHAIN_ID_TO_RPC, MS_ADDRESS } from "../../utils/constants";
import { SafeTransactionHelper, TenderlyConfig } from "../../utils/safe-proposer/safe-transaction";
import { CHAT_ID_ERROR, sendMessage } from "../../utils/telegram";
import { checkCurveVotes, votesFromSafeModule } from "./voterSafeModule";
import { IProposalMessageForOperationChannel } from "./interfaces/IProposalMessageForOperationChannel";
import { CURVE_OWNERSHIP_VOTER, CURVE_PARAMETER_VOTER } from "./addresses";

dotenv.config();

const ONE_HOUR = 3600
const DELAY_CURVE = 3 * 24 * ONE_HOUR
const DELAY_OTHERS = 2 * 24 * ONE_HOUR
const DELAY_ONE_DAY = 1 * 24 * ONE_HOUR

const API_TOKEN_SD = process.env.TG_API_KEY;
const TELEGRAM_API = "https://api.telegram.org/bot" + API_TOKEN_SD + "/sendMessage"
const TELEGRAM_CHANNEL_ID = "@MetaGovernanceSD"
const TELEGRAM_GOVERNANCE_ID = "-1002204618754"
const CURVE_VOTER = "0x20b22019406Cf990F0569a6161cf30B8e6651dDa"

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

const getClosed = async (space: string, timePerSpaces: Record<string, number>): Promise<Proposal[]> => {
    let proposals: Proposal[] = [];

    const now = Math.floor(Date.now() / 1000);
    const fifteenMinutesAgo = now - 15 * 60; // 5 minutes en secondes

    // Requête GraphQL
    const query = gql`
      {
        proposals(
          where: {
            space_in: ["${space}"],
            end_gte: ${timePerSpaces[space] || fifteenMinutesAgo},
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

const getOriginalAngleProposal = async (proposal: Proposal): Promise<AngleProposal | undefined> => {
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
            switch (proposalSD.network) {
                case "1":
                    rpcProviderUrl = "https://eth.public-rpc.com"
                    break;
                case "56":
                    rpcProviderUrl = "https://rpc.ankr.com/bsc"
                    break;
                case "8453":
                    rpcProviderUrl = "https://base.drpc.org"
                    break;
                default:
                    await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Replication", `Impossible to find network space for ${space}`);
                    return;
            }
            pks = [process.env.PK_BOT_REPLICATION];
        }

        const provider = new JsonRpcProvider(rpcProviderUrl);
        const client = new snapshot.Client712(HUB_CLIENT);

        for (const pk of pks) {
            const signer = new Wallet(pk, provider);
            const address = signer.address;

            let symbolReason = proposalSD.space.symbol.replace("sd", "");
            if (space === "sdapw.eth") {
                symbolReason = "SPECTRA";
            }

            await client.vote(signer as any, address, {
                space: originalProposal.space.id,
                proposal: originalProposal.id,
                type: originalProposal.type as any,
                choice,
                metadata: JSON.stringify({}),
                reason: `Stake DAO ${symbolReason} Liquid Locker`
            });
        }

        return true;
    }
    catch (e) {
        console.log(e);
        return false;
    }
}

const getProposalMessageForOperationChannel = async (proposal: Proposal, token: string, space: string): Promise<IProposalMessageForOperationChannel | undefined> => {
    // Skip if proposal is our gauge vote and if it's not YFI (beacause YFI is 100% on snapshot)
    if (space !== "sdyfi.eth" && proposal.title.indexOf("Gauge vote") > -1) {
        return undefined;
    }

    const originSpace = originSpaces[space];
    const isCurveProposal = originSpace == "curve.eth";

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
    const total = proposal.scores.reduce((acc: number, score: number) => acc + score, 0);
    let payload: `0x${string}` | undefined = undefined;
    let voter: string | undefined = undefined;
    let args: any[] = [];

    if (total === 0) {
        // Nothing to replicate
        text += "✅ Nothing to replicate"

        // Tag as false even if true to avoid to compute the payload ...
        isOnchainProposal = false;
    } else if (proposal.quorum > total) {
        text += "❌ Not replication because of no quorum\n"

        // Tag as false even if true to avoid to compute the payload ...
        isOnchainProposal = false;
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
            if (choice === "No") {
                nay += score;
            } else if (choice === "Yes") {
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
                    text += "❌ Can't extract vote id\n"
                } else {
                    let votingAddress = undefined;
                    if (link.value.toLowerCase().includes("ownership")) {
                        votingAddress = CURVE_OWNERSHIP_VOTER;
                    } else if (link.value.toLowerCase().includes("parameter")) {
                        votingAddress = CURVE_PARAMETER_VOTER;
                    }

                    // Get PCT_BASE
                    const pctBase = Number(BigInt("1000000000000000000"))// await getPctBase(votingAddress);
                    if (pctBase === undefined) {
                        text += "❌ Error when fetch PCT_BASE\n"
                    } else {
                        text += "Vote id : " + voteId + "\n"
                        //text += "Voter : " + CURVE_VOTER + "\n"
                        //text += "Voting address : " + votingAddress + "\n"

                        const yeaBN = Math.floor(yea / totalVotes * pctBase);
                        const nayBN = pctBase - yeaBN;

                        args = [BigInt(voteId), BigInt(yeaBN), BigInt(nayBN), votingAddress];
                        payload = encodeFunctionData({
                            abi: CurveVoterABI,
                            functionName: 'votePct',
                            args,
                        });

                        voter = CURVE_VOTER;

                        //text += "Payload : " + payload + "\n"
                        text += "Vote : (" + votes.join(",") + ")\n"
                    }
                }
            } else {
                text += "❌ Can't extract http link\n"
            }
        } else if (isAngleOnChainProposal) {
            if (proposal.choices.length === 3) {
                const angleProposal = await getOriginalAngleProposal(proposal);
                if (angleProposal === undefined) {
                    text += "❌ Error when try to fetch original angle proposal \n"
                } else {
                    const snapshotTimestamp = parseInt(angleProposal.snapshotTimestamp);
                    if (isNaN(snapshotTimestamp)) {
                        text += "❌ Error when try to fetch original angle proposal - convert snapshot timestamp \n"
                    } else {
                        const votingPower = await getAngleVotingPower(snapshotTimestamp);
                        if (votingPower === undefined) {
                            text += "❌ Error when try to fetch original angle proposal - voting power \n"
                        } else {

                            let against = parseUnits(proposal.choices[0], 18);
                            let forr = parseUnits(proposal.choices[1], 18);
                            let abstain = parseUnits(proposal.choices[2], 18);

                            const total = against + forr + abstain;

                            const percentageAgainst = against * BigInt(100) / total;
                            const percentageForr = forr * BigInt(100) / total;
                            const percentageAbstain = abstain * BigInt(100) / total;

                            against = percentageAgainst * votingPower / BigInt(100);
                            forr = percentageForr * votingPower / BigInt(100);
                            abstain = percentageAbstain * votingPower / BigInt(100);

                            const id = hexToBigInt(angleProposal.id as `0x${string}`, { size: 32 })

                            payload = encodeFunctionData({
                                abi: AngleGovernorABI,
                                functionName: 'castVoteWithReasonAndParams',
                                args: [id, BigInt(0), "", against, forr, abstain]
                            });

                            voter = ANGLE_VOTER;

                            //text += "Angle voter V5 : " + ANGLE_VOTER + "\n"
                            //text += "Payload : " + payload + "\n"
                            text += "Vote : (" + votes.join(",") + ")\n"
                        }
                    }
                }
            } else {
                text += "❌ should have 3 choices \n"
            }
        } else {
            const originalProposal = await getOriginalProposal(proposal, space)
            if (originalProposal === undefined) {
                text += "❌ can't fetch original proposal \n"
            } else {
                for (let i = 0; i < 10; i++) {
                    const success = await replicateVote(space, proposal, originalProposal);
                    if (success) {
                        replicateDone = true;
                        break;
                    }
                }

                if (!replicateDone) {
                    await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Replication", `Replication failed from ${space}-${proposal.id}, check logs`);
                }
            }

            text += "Vote : (" + votes.join(",") + ") : "
            if (originalProposal !== undefined) {
                text += "<a href='https://snapshot.org/#/" + originSpace + "/proposal/" + originalProposal.id + "'>" + originSpace + "</a>\n"
            } else {
                text += "<a href='https://snapshot.org/#/" + originSpace + "'>" + originSpace + "</a>\n"
            }
        }

        //text += "Deadline : " + moment.unix(deadline).format("LLL") + " @chago0x @hubirb\n"

        if (!isOnchainProposal) {
            if (replicateDone) {
                text += "✅ Vote replication done"
            } else {
                text += "❌ Vote replication failed"
            }
        }
    }

    return {
        text,
        deadline,
        payload,
        args,
        voter,
        isOnchainProposal
    };
}


const formatSnapshotMessage = (proposalMessage: IProposalMessageForOperationChannel): string => {
    const lines = proposalMessage.text.split("\n");
    const voteReplicated = lines.pop()

    lines.push(`Deadline : ${moment.unix(proposalMessage.deadline).format("LLL")} @chago0x @hubirb`);
    lines.push(voteReplicated);

    return lines.join("\n");
}

const sendTelegramMsgInSDGovChannel = async (message: string) => {
    try {
        if (await sendMessage(API_TOKEN_SD, TELEGRAM_GOVERNANCE_ID, undefined, message)) {
            console.log('Message envoyé avec succès');
        } else {
            console.error('Erreur lors de l\'envoi du message');
        }
    } catch (err) {
        console.error('Erreur lors de l\'envoi du message:', err);
    }

    await sleep(1000);
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
    const onchainVotes: IProposalMessageForOperationChannel[] = [];

    for (const space of ens) {
        const proposals = await getClosed(space, timePerSpaces);
        for (const proposal of proposals) {
            await sendTextToTelegramChat(proposal, spaces[space], false, false, true);

            const message = await getProposalMessageForOperationChannel(proposal, spaces[space], space);
            if (message) {
                if (message.isOnchainProposal) {
                    onchainVotes.push(message);
                } else {
                    await sendTelegramMsgInSDGovChannel(formatSnapshotMessage(message));
                }
            }
        }
    }

    // Push votes
    if (onchainVotes.length > 0) {
        try {
            const tx = await votesFromSafeModule(onchainVotes);
            if (tx === undefined) {
                // error
                await sendTelegramMsgInSDGovChannel("Error when sending votes from safe module, check logs @chago0x @pi3rrem");
            } else if (tx !== null) {
                const votesOk = await checkCurveVotes(onchainVotes);
                let message = "";
                if (tx.status === "success" && votesOk) {
                    message = `✅ Vote${onchainVotes.length > 1 ? "s" : ""}`;
                    message += ` ${onchainVotes.map((vote) => vote.args[0].toString()).join("-")} sent from safe module\n`;
                    message += `Tx : <a href="https://etherscan.io/tx/${tx.transactionHash}">etherscan.io</a>\n`;
                } else {
                    message = `❌ Vote${onchainVotes.length > 1 ? "s" : ""}`;
                    message += ` ${onchainVotes.map((vote) => vote.args[0].toString()).join("-")} sent from safe module but the tx reverted\n`;
                    message += `Tx : <a href="https://etherscan.io/tx/${tx.transactionHash}">etherscan.io</a>\n`;
                }

                message += "@chago0x @pi3rrem";

                await sendTelegramMsgInSDGovChannel(message);
            }
        }
        catch (e) {
            await sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Replication", e.error_description || e.message || "");
            console.log(e);
        }
    }

    // Change timestamp for the next run
    for (const space of ens) {
        timePerSpaces[space] = now + 1;
    }

    // Clear proposals fetched
    const twoDaysAgo = now - ONE_HOUR * 24 * 2;
    const newProposalFetched: ProposalFetched[][] = [];
    newProposalFetched.push(proposalsFetched[0].filter((p) => p.ts > twoDaysAgo));
    newProposalFetched.push(proposalsFetched[1].filter((p) => p.ts > twoDaysAgo));

    fs.writeFileSync("./data/replication.json", JSON.stringify(timePerSpaces), { encoding: 'utf-8' });
    fs.writeFileSync("./data/replication_proposals.json", JSON.stringify(newProposalFetched), { encoding: 'utf-8' });
};

main().catch((e) => {
    console.error(e);
    sendMessage(process.env.TG_API_KEY_BOT_ERROR, CHAT_ID_ERROR, "Replication", `${e.error_description || e.message || ""}`)
        .finally(() => process.exitCode = 1);
});