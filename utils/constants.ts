import * as dotenv from "dotenv";
import * as chains from 'viem/chains'

dotenv.config();

export const ANGLE_ONCHAIN_SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cltpyx1eh5g5v01xi0a5h5xea/subgraphs/governance-eth/prod/gn"

export const CHAIN_ID_TO_RPC = {
    1: "https://eth-mainnet.g.alchemy.com/v2/" + process.env.WEB3_ALCHEMY_API_KEY,
    56: "https://sleek-solitary-mansion.bsc.quiknode.pro/b818cf0343b83e2a6eecc966b96a4002b474e624/",
    42161: "https://arb-mainnet.g.alchemy.com/v2/" + process.env.WEB3_ALCHEMY_API_KEY,
    8453: "https://base-mainnet.g.alchemy.com/v2/" + process.env.WEB3_ALCHEMY_API_KEY,
    10: "https://opt-mainnet.g.alchemy.com/v2/" + process.env.WEB3_ALCHEMY_API_KEY,
    137: "https://polygon-mainnet.g.alchemy.com/v2/" + process.env.WEB3_ALCHEMY_API_KEY,
    146: "https://sonic.drpc.org",
}

export const MS_ADDRESS = "0xB0552b6860CE5C0202976Db056b5e3Cc4f9CC765";
export const CURVE_GC = "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB" as `0x${string}`;
export const etherscans = [
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

export const CURVE_API = "https://d3dl9x5bpp6us7.cloudfront.net"