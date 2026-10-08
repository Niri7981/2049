import { getStandardTokenAccount } from '../payment/payment-preflight';
import { readPaymentJson } from '../payment/read-payment-json';
import { resolvePaymentEnvironment, type PaymentEnvironment } from '../payment/payment-environment';

/** Wallet balance is best-effort network data, separate from local spending authority. */
export async function readWalletBalance(address: string, fetcher: typeof fetch = fetch, selectedEnvironment?: PaymentEnvironment) {
  try {
    const environment = selectedEnvironment ?? resolvePaymentEnvironment();
    const unit = environment.isProduction ? environment.asset.symbol : `Test ${environment.asset.symbol}`;
    const display = (amount: string) => { const cents = (BigInt(amount) + 5_000n) / 10_000n; return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')} ${unit}`; };
    const asset = environment.asset;
    const rpcUrl = new URL(environment.rpcUrl);
    if (rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password) throw new Error();
    if (environment.mode === 'live_mainnet') {
      const genesisResponse = await fetcher(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }), signal: AbortSignal.timeout(6_000), redirect: 'error' });
      const genesis = await readPaymentJson(genesisResponse, 65_536);
      if (!genesisResponse.ok || !genesis || typeof genesis !== 'object' || !('result' in genesis) || genesis.result !== environment.genesisHash) throw new Error();
    }
    const ata = await getStandardTokenAccount(address, asset.mint);
    const response = await fetcher(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [ata, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
      signal: AbortSignal.timeout(6_000), redirect: 'error' });
    const body: unknown = await readPaymentJson(response, 65_536);
    if (!response.ok || typeof body !== 'object' || body === null || !('result' in body)) throw new Error();
    const account = (body as { result?: { value?: unknown } }).result?.value;
    if (account === null) return { amount: '0', display: display('0'), available: true as const };
    const parsed = account && typeof account === 'object' ? account as { owner?: unknown; data?: { parsed?: { info?: { owner?: unknown; mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } : undefined;
    const info = parsed?.data?.parsed?.info; const token = info?.tokenAmount; const amount = token?.amount;
    if (parsed?.owner !== asset.tokenProgram || info?.owner !== address || info?.mint !== asset.mint || token?.decimals !== asset.decimals || typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error();
    return { amount, display: display(amount), available: true as const };
  } catch {
    return { amount: null, display: '暂时无法读取', available: false as const };
  }
}
