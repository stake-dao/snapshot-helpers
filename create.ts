import * as dotenv from "dotenv";
import { BytesLike, ethers } from "ethers";
import snapshot from "@snapshot-labs/snapshot.js";
import { request, gql } from 'graphql-request'
import moment from "moment";
import axios from "axios";
import * as chains from 'viem/chains'
import { createPublicClient, http, parseAbi } from "viem";

const SPACES = ["sdcrv.eth", "sdfxs.eth", "sdangle.eth", "sdbal.eth", "sdpendle.eth", "sdcake.eth", "sdfxn.eth", "sdapw.eth", "sdmav.eth"];
const NETWORK_BY_SPACE = {
  "sdcrv.eth": "ethereum",
  "sdfxs.eth": "ethereum",
  "sdangle.eth": "ethereum",
  "sdbal.eth": "ethereum",
  "sdpendle.eth": "ethereum",
  "sdcake.eth": "bsc",
  "sdfxn.eth": "ethereum",
  "sdapw.eth": "ethereum",
  "sdmav.eth": "ethereum",
};
const SDCRV_CRV_GAUGE = "0x26f7786de3e6d9bd37fcf47be6f2bc455a21b74a"
const ARBITRUM_VSDCRV_GAUGE = "0xF1bb643F953836725c6E48BdD6f1816f871d3E07";
const SEP_START_ADDRESS = "- 0x";
const SEP_DOT = "…";

dotenv.config();

const extractAddress = (address: string): string => {
  return address.substring(0, 17) + SEP_DOT + address.substring(address.length - 2);
}

const getBlockByTimestamp = async (network: string, timestamp: number): Promise<number> => {
  const data = await axios.get("https://coins.llama.fi/block/" + network + "/" + timestamp);
  return data.data.height;
}

const getCurveGauges = async (): Promise<string[]> => {
  const data = await axios.get("https://api.curve.fi/api/getAllGauges");
  const gaugesMap = data.data.data;

  const response: string[] = [];
  for (const key of Object.keys(gaugesMap)) {
    if (gaugesMap[key].is_killed) {
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
  try {
    const data = await axios.get("https://api.angle.money/v1/dao");
    const gauges = data.data.gauges.list;

    const response: string[] = [];
    for (const gauge of Object.keys(gauges)) {
      if (gauges[gauge].deprecated) {
        continue;
      }
      response.push(gauges[gauge].name + " - " + extractAddress(gauges[gauge].address));
    }

    return response;
  }
  catch (e) {
    return [];
  }
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

  const { data: chainIds } = await axios.get("https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/chainIds.json");

  const SIZE = 100;
  const response: string[] = [];

  for (const chainId of Object.keys(chainIds)) {
    let run = true;
    let skip = 0;

    do {
      try {
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
      catch (e) {
        run = false;
      }
    }
    while (run);
  }

  return response;
};

const getPancakeGauges = async (): Promise<string[]> => {
  const data = await axios.get(`https://pancakeswap.finance/api/gauges/getAllGauges?inCap=true&testnet=`);
  const gauges = data.data.data;

  const response: string[] = [];

  for (const gauge of gauges) {
    response.push(gauge.pairName + " / " + getChainIdName(gauge.chainId) + " - " + extractAddress(gauge.address));
  }

  return response;
};

const getChainIdName = (chainId: number): string => {
  for (const chain of Object.values(chains)) {
    if ('id' in chain) {
      if (chain.id === chainId) {
        return chain.name;
      }
    }
  }

  return chainId.toString();
}

const getFxnGauges = async (): Promise<string[]> => {
  const data = await axios.get("https://api.aladdin.club/api1/get_fx_gauge_list");
  const gaugesMap = data.data.data;

  const response: string[] = [];
  for (const key of Object.keys(gaugesMap)) {
    const gauge = gaugesMap[key].gauge as string;
    const name = gaugesMap[key].name as string;
    response.push(name + " - " + extractAddress(gauge));
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

const getSpectraGauges = async (): Promise<string[]> => {
  const VOTER = "0x3d72440af4b0312084BC51A2038180876D208832" as `0x${string}`;
  const GOVERNANCE = "0x4425779F145f6599CFCeAa9443b497a7a2DFdB17" as `0x${string}`;

  const publicClient = createPublicClient({
    chain: chains.mainnet,
    transport: http()
  });

  const voterAbi = parseAbi([
    'function getAllPoolIds() external view returns(uint160[])',
    'function isVoteAuthorized(uint160 poolId) external view returns(bool)'
  ]);

  const governanceAbi = parseAbi([
    'function poolsData(uint160 poolId) external view returns(address,uint256,bool)',
  ]);

  const poolAbi = parseAbi([
    'function coins(uint256 id) external view returns(address)',
  ]);

  const ptAbi = parseAbi([
    'function symbol() external view returns(string)',
    'function maturity() external view returns(uint256)',
  ]);

  // Get all ids
  const results = await publicClient.multicall({
    contracts: [
      {
        address: VOTER,
        abi: voterAbi,
        functionName: 'getAllPoolIds',
      }
    ]
  });

  const ids = results.shift().result as bigint[];

  // Check if id is authorized to vote for
  const results2 = await publicClient.multicall({
    contracts: ids.map((id) => {
      return {
        address: VOTER,
        abi: voterAbi,
        functionName: 'isVoteAuthorized',
        args: [id]
      }
    })
  });

  const idsAuthorized: bigint[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const isAuthorized = results2.shift().result as boolean;
    if (isAuthorized) {
      idsAuthorized.push(id);
    }
  }

  // Get pool data for pool address
  const results3 = await publicClient.multicall({
    contracts: idsAuthorized.map((id) => {
      return {
        address: GOVERNANCE,
        abi: governanceAbi,
        functionName: 'poolsData',
        args: [id]
      }
    })
  });

  const pools: any[] = [];

  for (const id of idsAuthorized) {
    const poolData = results3.shift().result as any;
    pools.push({
      id: id.toString(),
      poolAddress: poolData[0] as `0x${string}`,
    })
  }

  const results4 = await publicClient.multicall({
    contracts: pools.map((pool) => {
      return {
        address: pool.poolAddress,
        abi: poolAbi,
        functionName: 'coins',
        args: [1] // PT
      }

    })
  });

  for (const pool of pools) {
    const coinPT = results4.shift().result as `0x${string}`;

    pool.coinPT = coinPT;
  }

  const results5 = await publicClient.multicall({
    contracts: pools
      .filter((pool) => pool.coinPT !== undefined)
      .map((pool) => {
        return {
          address: pool.coinPT,
          abi: ptAbi,
          functionName: 'symbol',
        }
      }),
    allowFailure: true
  });

  const responses: string[] = [
    "Blank"
  ];

  for (const pool of pools) {
    if (!pool.coinPT) {
      continue;
    }
    const s = results5.shift();
    const symbol = s.result as string;

    if (!symbol) {
      continue;
    }

    const splits = symbol.split("-");
    const maturity = parseInt(splits.pop());

    const maturityFormatted = moment.unix(maturity).format("L");
    responses.push(splits.join("-") + "-" + maturityFormatted);
  }

  return responses;
};

const vote = async (gauges: string[], proposalId: string, pkStr: string, targetGaugeAddress: string) => {

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
    if (targetGaugeAddress.toLowerCase().indexOf(startAddress.toLowerCase()) === -1) {
      continue;
    }

    choiceIndex = i;
    break;
  }

  if (choiceIndex === -1) {
    console.log("Impossible to find target gauge. Proposal id : ", proposalId, targetGaugeAddress);
    return;
  }

  const hub = process.env.HUB;

  const client = new snapshot.Client712(hub);
  const pk: BytesLike = pkStr;
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

const getMavGauges = async (): Promise<string[]> => {

  const { data: chainIds } = await axios.get("https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/chainIds.json");

  const response: string[] = [];

  for (const chainId of [chains.mainnet.id]) {

    try {
      const data = await axios.get(`https://maverick-v2-api-delta.vercel.app/api/v5/rewardContracts/${chainId}`);
      const gauges = data.data.rewardContracts;

      for (const gauge of gauges) {
        const findRewardWithVe = gauge.rewards.some((reward) => reward.veRewardTokenAddress !== "0x0000000000000000000000000000000000000000");
        if (!findRewardWithVe) {
          continue;
        }

        const name = gauge.position.pool.tokenA.symbol + "-" + gauge.position.pool.tokenB.symbol + " #" + gauge.number;
        response.push(name + " - " + chainId + " - " + gauge.boostedPositionAddress);
      }
    }
    catch (e) {
    }
  }

  return response;
};

const main = async () => {

  const hub = process.env.HUB;

  const client = new snapshot.Client(hub);
  const pk: BytesLike = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : "";

  const signingKey = new ethers.utils.SigningKey(pk);
  const web3 = new ethers.Wallet(signingKey);

  const now = moment().unix();

  const blockTimestamp = moment().set('hours', 2).set('minute', 0).set('second', 0).set('millisecond', 0).utc(false).unix()
  const startProposal = blockTimestamp - 3600;

  for (const space of SPACES) {
    const snapshotBlock = await getBlockByTimestamp(NETWORK_BY_SPACE[space], blockTimestamp - (2 * 3600));

    const lastGaugeProposal = await getLastGaugeProposal(space);

    // Check if we are at least 10 days after the last proposal
    // Because all our gauge votes are bi-monthly
    // Except for pendle, every week
    const isPendle = space.toLowerCase() === "sdpendle.eth".toLowerCase();
    const diff = isPendle ? 6 : 10;

    if (lastGaugeProposal && lastGaugeProposal.created + (diff * 86400) > now) {
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
      case "sdcake.eth":
        gauges = await getPancakeGauges();
        break;
      case "sdfxn.eth":
        gauges = await getFxnGauges();
        break;
      case "sdapw.eth":
        gauges = await getSpectraGauges();
        break;
      case "sdmav.eth":
        gauges = await getMavGauges();
        break;
    }

    if (gauges.length === 0) {
      continue;
    }

    let startProposalDate = moment().add(9, "days");
    if (space === "sdapw.eth") {
      startProposalDate = startProposalDate.subtract(1, "days");
    }

    let day = startProposalDate.date();
    let month = startProposalDate.month() + 1;
    let year = startProposalDate.year();

    let endProposal: moment.Moment = null;;
    if (space === "sdmav.eth") {
      // For mav, title proposal is from friday to thrusday
      endProposal = moment(startProposalDate.add(1, 'day')).add(13, 'days');
    }
    else if (space === "sdapw.eth") {
      endProposal = moment(startProposalDate).add(13, 'days');
    } else {
      endProposal = moment(startProposalDate).add(isPendle ? 6 : 13, 'days');
    }

    const dayEnd = endProposal.date();
    const monthEnd = endProposal.month() + 1;
    const yearEnd = endProposal.year();

    let label = space.replace("sd", "").replace(".eth", "").toUpperCase();
    const network = space === "sdcake.eth" ? '56' : '1';

    // Case for APW
    if (label.toLowerCase() === "apw") {
      label = "Spectra".toUpperCase();
    }

    try {
      const proposal = {
        space: space,
        type: "weighted",
        title: "Gauge vote " + label + " - " + day + "/" + month + "/" + year + " - " + dayEnd + "/" + monthEnd + "/" + yearEnd,
        body: "Gauge vote for " + label + " inflation allocation.",
        discussion: "https://votemarket.stakedao.org/votes",
        choices: gauges,
        start: startProposal,
        end: startProposal + (4 * 86400) + (86400 / 2) + 3600, // 4.5 + 1h days after
        snapshot: snapshotBlock,
        plugins: JSON.stringify({}),
        metadata: {
          network
        },
      } as any;
      const receipt = await client.proposal(web3, web3.address, proposal) as any;

      if (space !== "sdcrv.eth") {
        continue;
      }

      // Push a vote on mainnet from PK for sdCRV/CRV gauge
      await vote(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY, SDCRV_CRV_GAUGE);
      await vote(gauges, receipt.id as string, process.env.ARBITRUM_VOTE_PRIVATE_KEY, ARBITRUM_VSDCRV_GAUGE);
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
