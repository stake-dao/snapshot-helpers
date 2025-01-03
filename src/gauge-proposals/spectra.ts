import { CreateProposal } from "./createProposal";
import moment from "moment";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAIN_ID_TO_RPC } from "../../utils/constants";
import * as chains from 'viem/chains'

class SpectraCreateProposal extends CreateProposal {

    protected canExecute(): boolean {
        return true;
    }

    protected getSpaceNetwork(): string {
        return "ethereum";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(6, 'days');
    }

    protected getLabelTitle(): string {
        return "SPECTRA";
    }

    protected getChainId(): string {
        return "1";
    }

    protected getSpace(): string {
        return "sdapw.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {

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
        const contracts = ids.map((id) => {
            return {
                address: VOTER,
                abi: voterAbi,
                functionName: 'isVoteAuthorized',
                args: [id]
            } as any
        }) as any[];
        const results2 = await publicClient.multicall({contracts});

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
            const chain = this.getChain(pool.chainId);
            if (!chain) {
                continue;
            }

            pool.chainName = this.getChainIdName(pool.chainId);

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
            if (maturity < now) {
                continue;
            }

            const maturityFormatted = moment.unix(maturity).format("L");

            const chainName = pool.chainName.toLowerCase().replace(" ", "");

            let name = chainName + "-" + splits.join("-") + "-" + maturityFormatted;
            name = name.replace("-PT", "");
            responses.push(name);
        }

        return responses;
    }
}

new SpectraCreateProposal().job();