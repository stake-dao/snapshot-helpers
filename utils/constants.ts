export const ANGLE_ONCHAIN_SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cltpyx1eh5g5v01xi0a5h5xea/subgraphs/governance-eth/prod/gn"

export const CHAIN_ID_TO_RPC = {
    1: "https://eth-mainnet.g.alchemy.com/v2/"+process.env.WEB3_ALCHEMY_API_KEY,
    56: "https://sleek-solitary-mansion.bsc.quiknode.pro/b818cf0343b83e2a6eecc966b96a4002b474e624/",
    42161: "https://arb-mainnet.g.alchemy.com/v2/"+process.env.WEB3_ALCHEMY_API_KEY,
    8453: "https://base-mainnet.g.alchemy.com/v2/"+process.env.WEB3_ALCHEMY_API_KEY,
    10: "https://opt-mainnet.g.alchemy.com/v2/"+process.env.WEB3_ALCHEMY_API_KEY,
    137: "https://polygon-mainnet.g.alchemy.com/v2/"+process.env.WEB3_ALCHEMY_API_KEY
}