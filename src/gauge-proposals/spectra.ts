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
        return "base";
    }

    protected getEndProposalTimestamp(startProposalTimestamp: moment.Moment): moment.Moment {
        return moment(startProposalTimestamp).add(6, 'days');
    }

    protected getLabelTitle(): string {
        return "SPECTRA";
    }

    protected getChainId(): string {
        return "8453";
    }

    protected getSpace(): string {
        return "sdspectra.eth";
    }

    protected async getGauges(snapshotBlock: number): Promise<string[]> {

        const VOTER_CONTRACT = "0x174a1f4135Fab6e7B6Dbe207fF557DFF14799D33" as `0x${string}`;
        const GOVERNANCE = "0xa3eeA13183421c9A8BDA0BDEe191B70De8CA445D" as `0x${string}`;

        const publicClient = createPublicClient({
            chain: chains.base,
            transport: http(CHAIN_ID_TO_RPC[8453])
        });

        const voterAbi = parseAbi([
            'function isVoteAuthorized(uint160 poolId) external view returns(bool)',
            'function poolIds(uint256 poolId) external view returns(uint160)',
            'function length() external view returns(uint256)'
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
        // @ts-ignore
        let results = await (publicClient.multicall({
            contracts: [
                {
                    address: VOTER_CONTRACT,
                    abi: voterAbi,
                    functionName: 'length',
                } as any
            ] as any
        }) as any);

        const poolIdsLength = results.shift().result;

        let calls = Array.from(Array(Number(poolIdsLength)).keys()).map(
            (_, index) => ({
                address: VOTER_CONTRACT,
                abi: voterAbi,
                functionName: "poolIds",
                args: [index],
                chainId: chains.base.id
            })
        ) as any[];

        // @ts-ignore
        const poolIds = (await publicClient.multicall({ contracts: calls })).map(({ result }) => result as bigint)

        calls = [];
        for (const poolId of poolIds) {
            calls.push({
                address: GOVERNANCE,
                abi: governanceAbi,
                functionName: "poolsData",
                args: [poolId],
                chainId: chains.base.id,
            });
            calls.push({
                address: VOTER_CONTRACT,
                abi: voterAbi,
                functionName: "isVoteAuthorized",
                args: [poolId],
                chainId: chains.base.id,
            });
        }
        results = await publicClient.multicall({ contracts: calls });

        const pools: any[] = [];
        for (const poolId of poolIds) {
            const poolData = results.shift().result as any;
            const isVoteAuthorizedRes = results.shift();
            const isVoteAuthorized = isVoteAuthorizedRes.result as boolean;
            const isRegistered = poolData![2] as boolean;

            if (!isRegistered || !isVoteAuthorized) {
                continue;
            }

            pools.push({
                id: poolId.toString(),
                poolAddress: poolData[0] as `0x${string}`,
                chainId: Number(BigInt(poolData[1])),
            });
        }

        for (const pool of pools) {
            const chain = this.getChain(pool.chainId);
            if (!chain) {
                console.log("skip", pool)
                continue;
            }

            pool.chainName = this.getChainIdName(pool.chainId);

            const client = createPublicClient({
                chain: chain,
                transport: http(CHAIN_ID_TO_RPC[pool.chainId])
            });

            console.log(pool.chainId, CHAIN_ID_TO_RPC[pool.chainId])

            // @ts-ignore
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
            console.log(pool.coinPT)
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

        console.log(responses)
        return responses;
    }
}

new SpectraCreateProposal().job();