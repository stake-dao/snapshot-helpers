import * as dotenv from "dotenv";
import { BytesLike, ethers } from "ethers";
import snapshot from "@snapshot-labs/snapshot.js";
import { request, gql } from 'graphql-request'
import moment from "moment";
import * as momentTimezone from "moment-timezone";
import axios from "axios";
import * as chains from 'viem/chains'
import { createPublicClient, http, parseAbi } from "viem";
import * as lodhash from 'lodash';
import { sleep } from "./utils/sleep";
import { sendMessage } from "./utils/telegram";
import { CHAIN_ID_TO_RPC } from "./utils/constants";

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
const ARBITRUM_VSDCRV_GAUGE = "0xf1bb643f953836725c6e48bdd6f1816f871d3e07";
const POLYGON_VSDCRV_GAUGE = "0x8ad6f98184a0cb79887244b4e7e8beb1b4ba26d4";
const SEP_START_ADDRESS = "- 0x";
const SEP_DOT = "…";
const CURVE_GC = "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB" as `0x${string}`;

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

  const publicClient = createPublicClient({
    chain: chains.mainnet,
    transport: http(CHAIN_ID_TO_RPC[1])
  });

  const gcAbi = parseAbi([
    'function gauge_types(address gauge) external view returns(int128)',
  ]);

  const gaugesKeys = Object.keys(gaugesMap);
  const calls: any[] = [];
  for (const key of gaugesKeys) {
    if (gaugesMap[key].is_killed) {
      continue;
    }

    calls.push({
      address: CURVE_GC,
      abi: gcAbi,
      functionName: 'gauge_types',
      args: [gaugesMap[key].gauge]
    });
  }

  let results: any[] = [];
  const chunks = lodhash.chunk(calls, 50);
  for (const c of chunks) {
    // @ts-ignore
    const res = await (publicClient.multicall({contracts: c as any}) as any);
    results = results.concat(res);
  }

  const response: string[] = [];
  for (const key of gaugesKeys) {
    if (gaugesMap[key].is_killed) {
      continue;
    }

    const gaugeAdded = results.shift()?.error === undefined;
    if (!gaugeAdded) {
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

    let countChain = 0;
    do {
      try {
        countChain++;
        if (countChain === 80) {
          await sleep(2 * 1000); // Sleep 2s to avoid rate limit from Pendle
          countChain = 0;
        }
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
          if (name.indexOf("PT-") > -1) {
            name = name.replace("PT-", "");
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
  
  const etherscans = [
    {
      chain: chains.bsc,
      apiKey: process.env.BSCSCAN_API_KEY,
      url: 'api.bscscan.com',
      blockPerSec: 3
    },
    {
      chain: chains.mainnet,
      apiKey: process.env.ETHERSCAN_API_KEY,
      url: 'api.etherscan.io',
      blockPerSec: 12
    },
    {
      chain: chains.arbitrum,
      apiKey: process.env.ARBISCAN_API_KEY,
      url: 'api.arbiscan.io',
      blockPerSec: 0.25
    }
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
            const isOldOneYear = (now - createdTimestamp) >= ((30*11) * 86400)
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

    response.push(gauge.pairName + " / " + getChainIdName(gauge.chainId) + " - " + extractAddress(gauge.address));
  }

  console.log("nb pancake gauge : ", response.length);
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

const getChain = (chainId: number): chains.Chain | undefined => {
  for (const chain of Object.values(chains)) {
    if ('id' in chain) {
      if (chain.id === chainId) {
        return chain;
      }
    }
  }

  return undefined;
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
        id
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
    transport: http(CHAIN_ID_TO_RPC[1])
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
  const results = await (publicClient.multicall({
    contracts: [
      {
        address: VOTER,
        abi: voterAbi as any,
        functionName: 'getAllPoolIds',
      } as any
    ] as any
  }) as any);

  const ids = results.shift().result as bigint[];

  // Check if id is authorized to vote for
  const results2 = await publicClient.multicall({
    contracts: ids.map((id) => {
      return {
        address: VOTER,
        abi: voterAbi,
        functionName: 'isVoteAuthorized',
        args: [id]
      } as any
    })
  });

  const idsAuthorized: bigint[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const isAuthorized = (results2.shift().result as any) as boolean;
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
      chainId: Number(BigInt(poolData[1])),
    })
  }

  for (const pool of pools) {
    const chain = getChain(pool.chainId);
    if (!chain) {
      continue;
    }

    pool.chainName = getChainIdName(pool.chainId);

    const client = createPublicClient({
      chain: chain,
      transport: http(CHAIN_ID_TO_RPC[pool.chainId])
    });

    const res = await client.multicall({
      contracts: [
        {
          address: pool.poolAddress as `0x${string}`,
          abi: poolAbi,
          functionName: 'coins',
          args: [BigInt(1)] // PT
        }
      ]
    });

    pool.coinPT = res.shift().result;
    if (pool.coinPT !== undefined) {
      const resSymbol = await client.multicall({
        contracts: [
          {
            address: pool.coinPT,
            abi: ptAbi,
            functionName: 'symbol',
          }
        ],
        allowFailure: true
      });

      const s = resSymbol.shift();
      const symbol = s.result as string;
      pool.symbol = symbol;
    }
  }


  const responses: string[] = [
    "Blank"
  ];

  const now = moment().unix();

  for (const pool of pools) {
    if (!pool.coinPT || !pool.symbol) {
      continue;
    }

    const splits = pool.symbol.split("-");
    const maturity = parseInt(splits.pop());
    if(maturity < now) {
      continue;
    }

    const maturityFormatted = moment.unix(maturity).format("L");

    const chainName = pool.chainName.toLowerCase().replace(" ", "");

    let name = chainName + "-" + splits.join("-") + "-" + maturityFormatted;
    name = name.replace("-PT", "");
    responses.push(name);
  }

  return responses;
};

const voteCRV = async (gauges: string[], proposalId: string, pkStr: string, targetGaugeAddress: string) => {

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
    await client.vote(web3 as any, web3.address, {
      space: 'sdcrv.eth',
      proposal: proposalId,
      type: 'weighted',
      choice,
    });
  }
  catch (e) {
    console.log(e);
    await sendMessage(`Create weekly proposal`, `Can't vote for CRV proposal - ${e.error_description || e.message || ""}`);
  }
};

const voteCake = async (gauges: string[], proposalId: string, pkStr: string) => {

  const gaugesToVote = [
    {
      gauge: "0xB1D54d76E2cB9425Ec9c018538cc531440b55dbB", // sdcake stable
      weight: 90,
    },
    {
      gauge: "0x52b59E3eAdc7C4ce8d3533020ca0Cd770E4eAbC3", // defiedge sdt-bnb
      weight: 10,
    }
  ];

  const choice = {};
  for (const gaugeToVote of gaugesToVote) {
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
      if (gaugeToVote.gauge.toLowerCase().indexOf(startAddress.toLowerCase()) === -1) {
        continue;
      }

      choice[(i + 1).toString()] = gaugeToVote.weight;
      break;
    }
  }

  if (Object.keys(choice).length !== gaugesToVote.length) {
    console.log("Impossible to find target Pancake gauges. Proposal id : ", proposalId);
    return;
  }

  const hub = process.env.HUB;

  const client = new snapshot.Client712(hub);
  const pk: BytesLike = pkStr;
  const web3 = new ethers.Wallet(pk);

  try {
    await client.vote(web3 as any, web3.address, {
      space: 'sdcake.eth',
      proposal: proposalId,
      type: 'weighted',
      choice,
    });
  }
  catch (e) {
    console.log(e);
    await sendMessage(`Create weekly proposal`, `Can't vote for CAKE proposal - ${e.error_description || e.message || ""}`);
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
        if (name.endsWith("*")) {
          // Old ones
          continue;
        }

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

  const blockTimestamp = moment().utc().set('hours', 2).set('minute', 0).set('second', 0).set('millisecond', 0);
  const startTimestamp = blockTimestamp.unix();
  const endTimestamp = momentTimezone.unix(startTimestamp).tz('Europe/Paris').add(5, "days").set('hours', 16).set('minute', 0).set('second', 0).set('millisecond', 0).unix();

  for (const space of SPACES) {
    const snapshotBlock = await getBlockByTimestamp(NETWORK_BY_SPACE[space], startTimestamp);

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

    let startProposalDate = moment().add(7, "days");
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
    }
    else if (isPendle) {
      endProposal = moment(startProposalDate).add(6, 'days');
    }
    else {
      endProposal = moment(startProposalDate).add(13, 'days');
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
        start: startTimestamp,
        end: endTimestamp,
        snapshot: snapshotBlock,
        plugins: JSON.stringify({}),
        metadata: {
          network
        },
      } as any;
      const receipt = await client.proposal(web3 as any, web3.address, proposal) as any;

      if (space === "sdcrv.eth") {
        // Wait 5 minutes to be in the voting window
        await sleep(5 * 60 * 1000);

        // Push a vote on mainnet from PK for sdCRV/CRV gauge
        await voteCRV(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY, SDCRV_CRV_GAUGE);
        await voteCRV(gauges, receipt.id as string, process.env.ARBITRUM_VOTE_PRIVATE_KEY, ARBITRUM_VSDCRV_GAUGE);
        await voteCRV(gauges, receipt.id as string, process.env.POLYGON_VOTE_PRIVATE_KEY, POLYGON_VSDCRV_GAUGE);
      } else if (space === "sdcake.eth") {
        // Wait 5 minutes to be in the voting window
        await sleep(5 * 60 * 1000);

        await voteCake(gauges, receipt.id as string, process.env.VOTE_PRIVATE_KEY);
      }
    }
    catch (e) {
      console.error(e);
      await sendMessage("Create gauge proposals", `Space ${space} - ${e.error_description || e.message || ""}`);
    }
  }
}

const votes = async () => {
  const crvId = "0x21f3459d819727a34cb01654745cd5cd6c8a23dee31f718e40ae1cae56b2f1a3";
  const cakeId = "";

  if (crvId.length > 0) {
    const crvGauges = await getCurveGauges();
    await voteCRV(crvGauges, crvId as string, process.env.VOTE_PRIVATE_KEY, SDCRV_CRV_GAUGE);
    await voteCRV(crvGauges, crvId as string, process.env.ARBITRUM_VOTE_PRIVATE_KEY, ARBITRUM_VSDCRV_GAUGE);
    await voteCRV(crvGauges, crvId as string, process.env.POLYGON_VOTE_PRIVATE_KEY, POLYGON_VSDCRV_GAUGE);
  }

  if (cakeId.length > 0) {
    const cakeGauges = await getPancakeGauges();
    await voteCake(cakeGauges, cakeId as string, process.env.VOTE_PRIVATE_KEY);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
