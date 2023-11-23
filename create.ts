import * as dotenv from "dotenv";
import { BytesLike, ethers } from "ethers";
import snapshot from "@snapshot-labs/snapshot.js";
import { request, gql } from 'graphql-request'
import moment from "moment";
import axios from "axios";

const SPACES = ["sdcrv.eth", "sdfxs.eth", "sdangle.eth", "sdbal.eth", "sdpendle.eth"];
const SDCRV_CRV_GAUGE = "0x26f7786de3e6d9bd37fcf47be6f2bc455a21b74a"
const SEP_START_ADDRESS = "- 0x";
const SEP_DOT = "…";

dotenv.config();

const extractAddress = (address: string): string => {
  return address.substring(0, 17) + SEP_DOT + address.substring(address.length - 2);
}

const getBlockByTimestamp = async (timestamp: number): Promise<number> => {
  const data = await axios.get("https://coins.llama.fi/block/ethereum/" + timestamp);
  return data.data.height;
}

const getCurveGauges = async (): Promise<string[]> => {
  const data = await axios.get("https://api.curve.fi/api/getAllGauges");
  const gaugesMap = data.data.data;

  const response: string[] = [];
  for (const key of Object.keys(gaugesMap)) {
    if (gaugesMap[key].hasNoCrv || gaugesMap[key].is_killed) {
      continue;
    }

    const gauge = gaugesMap[key].gauge as string;
    response.push(key + " - " + extractAddress(gauge));
  }

  return response;
};

const getBalGauges = async (): Promise<string[]> => {

  const query = gql`{
      veBalGetVotingList
      {
        id
        address
        chain
        type
        symbol
        gauge {
          address
          isKilled
          relativeWeightCap
          addedTimestamp
          childGaugeAddress
        }
        tokens {
          address
          logoURI
          symbol
          weight
        }
      }
}`;

  const data = (await request("https://api-v3.balancer.fi/", query)) as any;
  const gauges = data.veBalGetVotingList.filter((item: any) => !item.gauge.isKilled);

  const response: string[] = [];
  for (const gauge of gauges) {
    response.push(gauge.symbol + " - " + extractAddress(gauge.gauge.address));
  }

  return response;
};

const getAngleGauges = async (): Promise<string[]> => {
  const data = await axios.get("https://api.angle.money/v1/dao");
  const gauges = data.data.gauges.list;

  const response: string[] = [];
  for (const gauge of Object.keys(gauges)) {
    if(gauges[gauge].deprecated) {
      continue;
    }
    response.push(gauges[gauge].name + " - " + extractAddress(gauges[gauge].address));
  }

  return response;
};

const getFraxGauges = async (): Promise<string[]> => {
  const data = await axios.get("https://api.frax.finance/v2/gauges");
  const gauges = data.data.gauges;

  const response: string[] = [];
  for (const gauge of gauges) {
    response.push(gauge.name + " - " + extractAddress(gauge.address));
  }

  return response;
};

const getPendleGauges = async (): Promise<string[]> => {
  const SIZE = 100;
  const response: string[] = [];

  for(const chainId of [1, 42161]) {
    
    let run = true;
    let skip = 0;
  
    do {
      const data = await axios.get(`https://api-v2.pendle.finance/core/v1/${chainId}/markets?limit=${SIZE}&is_expired=false&skip=${skip}`);
      const gauges = data.data.results;
  
      if (gauges.length === SIZE) {
        skip += SIZE;
      } else {
        run = false;
      }
  
      for (const gauge of gauges) {
        let name = gauge.pt.name;
        if (name.indexOf("PT ") > -1) {
          name = name.replace("PT ", "");
        }
        response.push(name + " - " + gauge.pt.chainId + "-" + gauge.address);
      }
    }
    while (run);
  }

  return response;
};

const getLastGaugeProposal = async (space: string) => {
  const query = gql`{
      proposals(
        where: {
          space: "`+ space + `"
        }
        orderBy: "created"
        orderDirection: desc
      ) {
			  title
			  created
      }
  }`;

  const data = (await request("https://hub.snapshot.org/graphql", query)) as any;
  for (const proposal of data.proposals) {
    if (proposal.title.indexOf("Gauge vote") > -1) {
      return proposal;
    }
  }

  return null;
};

const vote = async (gauges: string[], proposalId: string) => {

  let choiceIndex = -1;
  for (let i = 0; i < gauges.length; i++) {
    const gauge = gauges[i];
    const startIndex = gauge.indexOf(SEP_START_ADDRESS);
    if (startIndex === -1) {
      continue;
    }

    const endIndex = gauge.indexOf(SEP_DOT, startIndex);
    if (endIndex === -1) {
      continue;
    }

    const startAddress = gauge.substring(startIndex + SEP_START_ADDRESS.length - 2, endIndex);
    if (SDCRV_CRV_GAUGE.toLowerCase().indexOf(startAddress.toLowerCase()) === -1) {
      continue;
    }

    choiceIndex = i;
    break;
  }

  if (choiceIndex === -1) {
    console.log("Impossible to find sdCRV/CRV gauge. Proposal id : ", proposalId);
    return;
  }

  const hub = process.env.HUB;

  const client = new snapshot.Client712(hub);
  const pk: BytesLike = process.env.VOTE_PRIVATE_KEY ? process.env.VOTE_PRIVATE_KEY : "";
  const web3 = new ethers.Wallet(pk);

  const choice: any = {};
  choice[(choiceIndex + 1).toString()] = 1;

  try {
    await client.vote(web3, web3.address, {
      space: 'sdcrv.eth',
      proposal: proposalId,
      type: 'weighted',
      choice,
    });
  }
  catch (e) {
    console.log(e);
  }
};

const main = async () => {

  const hub = process.env.HUB;

  const client = new snapshot.Client712(hub);
  const pk: BytesLike = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";

  const signingKey = new ethers.utils.SigningKey(pk);
  const web3 = new ethers.Wallet(signingKey);

  const now = moment().unix();
  
  const startProposalDate = moment().add(7, "days");
  const day = startProposalDate.date();
  const month = startProposalDate.month() + 1;
  const year = startProposalDate.year();

  const blockTimestamp = moment().set('hours', 2).set('minute', 0).set('second', 0).set('millisecond', 0).utc(false).unix()
  const snapshotBlock = await getBlockByTimestamp(blockTimestamp - (2*3600));
  const startProposal = blockTimestamp - 3600;

  for (const space of SPACES) {
    const lastGaugeProposal = await getLastGaugeProposal(space);
    if (!lastGaugeProposal) {
      continue;
    }

    // Check if we are at least 10 days after the last proposal
    // Because all our gauge votes are bi-monthly
    const diff = 10;
    if (lastGaugeProposal.created + (diff * 86400) > now) {
      continue;
    }

    // Fetch gauges corresponding to space
    let gauges: string[] = [];

    switch (space) {
      case "sdcrv.eth":
        gauges = await getCurveGauges();
        break;
      case "sdfxs.eth":
        gauges = await getFraxGauges();
        break;
      case "sdangle.eth":
        gauges = await getAngleGauges();
        break;
      case "sdbal.eth":
        gauges = await getBalGauges();
        break;
      case "sdpendle.eth":
        gauges = await getPendleGauges();
        break;
    }

    if (gauges.length === 0) {
      continue;
    }

    const endProposal = moment(startProposalDate).add(13, 'days');
    const dayEnd = endProposal.date();
    const monthEnd = endProposal.month() + 1;
    const yearEnd = endProposal.year();

    const label = space.replace("sd", "").replace(".eth", "").toUpperCase();

    try {
      const receipt = await client.proposal(web3, web3.address, {
        space: space,
        type: "weighted",
        title: "Gauge vote " + label + " - " + day + "/" + month + "/" + year + " - " + dayEnd + "/" + monthEnd + "/" + yearEnd,
        body: "Gauge vote for " + label + " inflation allocation.",
        discussion: "https://votemarket.stakedao.org/votes",
        choices: gauges,
        start: startProposal,
        end: startProposal + 4 * 86400 + 86400 / 2, // 4.5 days after
        snapshot: snapshotBlock, // 18030841
        plugins: JSON.stringify({}),
      }) as any;

      if (space !== "sdcrv.eth") {
        continue;
      }

      // Push a vote from PK for sdCRV/CRV gauge
      await vote(gauges, receipt.id as string);
    }
    catch (e) {
      console.error(e);
    }
  }  
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
