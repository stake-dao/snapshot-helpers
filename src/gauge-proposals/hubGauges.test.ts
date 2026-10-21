import assert from 'node:assert/strict';
import { CrvCreateProposal } from './protocols/CrvCreateProposal';
import { YbCreateProposal } from './protocols/YbCreateProposal';
import { fetchHubGauges } from './hubGauges';

const root = '0x1111111111111111111111111111111111111111';
const child = '0x2222222222222222222222222222222222222222';
const pool = '0x3333333333333333333333333333333333333333';
const gauges = [
  { gauge: root, childGauge: child, chainId: 42161, name: 'Pool', pool, isKilled: false, coins: [{symbol: 'USDC'}, {symbol: 'crvUSD'}], weight: '9007199254740993123' },
  { gauge: pool, chainId: 1, name: 'Killed', pool, isKilled: true, coins: [] },
  { gauge: pool, chainId: 1, name: 'Lending', pool, isKilled: false, coins: [{symbol: 'crvUSD'}, {symbol: 'WBTC'}] },
];
const nativeFetch = globalThis.fetch;
const urls: string[] = [];
async function main() {
  globalThis.fetch = (async (input: any) => {
    const url = String(input); urls.push(url);
    if (url === 'https://chainlist.org/rpcs.json') return Response.json([{chainId: 42161, isTestnet: false, chainSlug: 'arbitrum'}]);
    assert.match(url, /^https:\/\/hub\.stakedao\.org\/v1\/votemarket\/(curve|yb)\/gauges$/);
    return Response.json({ lastUpdate: 1, totalGaugesWeight: '123', total: gauges.length, gauges });
  }) as typeof fetch;
  assert.deepEqual(await (new CrvCreateProposal() as any).getGauges(123), [
    'arbitrum-USDC+crvUSD (0x3333…3333) - 0x222222222222222…22',
    'Lending: Borrow crvUSD (WBTC collateral) (0x3333…3333) - 0x333333333333333…33',
  ]);
  assert.deepEqual(await (new YbCreateProposal() as any).getGauges(123), gauges.map(g => `${g.name} - ${g.chainId}-${g.gauge}`));
  assert.equal((await fetchHubGauges('curve'))[0].weight, '9007199254740993123');
  for (const response of [new Response('', { status: 503 }), Response.json({}), Response.json({ gauges: [] })]) {
    globalThis.fetch = (async () => response) as typeof fetch;
    await assert.rejects(fetchHubGauges('curve'));
  }
  console.log('Snapshot Hub consumer: choice ordering, root/child, killed gauges, exact weights and failures passed');
}
main().finally(() => { globalThis.fetch = nativeFetch; }).catch(error => { console.error(error); process.exitCode = 1; });
