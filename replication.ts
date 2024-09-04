import { request, gql, GraphQLClient } from "graphql-request";
import snapshot from "@snapshot-labs/snapshot.js";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import axios from "axios";
import * as dotenv from "dotenv";
import moment from "moment";
import { sleep } from "./utils/sleep";
import fs from 'fs';

dotenv.config();

const ONE_HOUR = 3600
const DELAY_CURVE = 3 * 24 * ONE_HOUR
const DELAY_OTHERS = 2 * 24 * ONE_HOUR


const API_TOKEN_SD = "5370000732:AAHcxlnTSMKe2zAv0EyCLMgcQePDIItEgk8"
const TELEGRAM_API = "https://api.telegram.org/bot" + API_TOKEN_SD + "/sendMessage"
const TELEGRAM_CHANNEL_ID = "@MetaGovernanceSD"
const TELEGRAM_GOVERNANCE_ID = "-1002204618754"
const TELEGRAM_CHANNEL_ID_TEST = "@testpierr"
const CURVE_VOTER = "0x20b22019406Cf990F0569a6161cf30B8e6651dDa"

// ANGLE
const ANGLE_GOVERNOR = "0x748bA9Cd5a5DDba5ABA70a4aC861b2413dCa4436"
const ANGLE_ONCHAIN_SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cltpyx1eh5g5v01xi0a5h5xea/subgraphs/governance-eth/prod/gn"
const VE_ANGLE = "0x0C462Dbb9EC8cD1630f1728B2CFD2769d09f0dd5"
const ANGLE_LOCKER = "0xD13F8C25CceD32cdfA79EB5eD654Ce3e484dCAF5"
const ANGLE_VOTER = "0x0E0F27b9d5F2bc742Bf547968d2f07dECBCf1A23"

const LAYOUT_TIME = "2006-01-02 15:04:05"

// Snapshot
const graphqlClient = new GraphQLClient('https://hub.snapshot.org/graphql');

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
}

interface GraphQLResponse {
    proposals: Proposal[];
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
    const fifteenMinutesAgo = now - 15 * 60; // 15 minutes en secondes

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

const sendToOperationsChannel = async (proposal: Proposal, token: string, space: string) => {

}

const main = async () => {

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
    let reminderTimestamp = moment().add(2, "h").unix()
    for (const space of ens) {
        const proposals = await getReminder(space, reminderTimestamp);
        for (const proposal of proposals) {
            await sendTextToTelegramChat(proposal, spaces[space], true, false, false);
        }
    }

    reminderTimestamp = moment().add(1, "d").unix()
    for (const space of ens) {
        const proposals = await getReminder(space, reminderTimestamp);
        for (const proposal of proposals) {
            await sendTextToTelegramChat(proposal, spaces[space], false, true, false);
        }
    }

    // Check closed
    for (const space of ens) {
        const proposals = await getClosed(space);
        for (const proposal of proposals) {
            await sendTextToTelegramChat(proposal, spaces[space], false, false, true);
            await sendToOperationsChannel(proposal, spaces[space], space);
        }
    }

    fs.writeFileSync("./data/replication.json", JSON.stringify(timePerSpaces), {encoding: 'utf-8'});
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});