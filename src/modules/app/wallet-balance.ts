import { getStandardTokenAccount } from '../payment/payment-preflight';
import { DEVNET_USDC_MINT, TOKEN_PROGRAM } from '../payment/payment-config';

/** Wallet balance is best-effort network data, separate from local spending authority. */
export async function readWalletBalance(address: string, fetcher: typeof fetch = fetch) {
  try {
    const rpcUrl = new URL(process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com');
    if (rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password) throw new Error();
    const ata = await getStandardTokenAccount(address, DEVNET_USDC_MINT);
    const response = await fetcher(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [ata, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
      signal: AbortSignal.timeout(6_000), redirect: 'error' });
    const text = await response.text();
    if (text.length > 65_536) throw new Error();
    const body: unknown = JSON.parse(text);
    if (!response.ok || typeof body !== 'object' || body === null || !('result' in body)) throw new Error();
    const account = (body as { result?: { value?: unknown } }).result?.value;
    if (account === null) return { amount: '0', display: '0.00 test USDC', available: true as const };
    const parsed = account && typeof account === 'object' ? account as { owner?: unknown; data?: { parsed?: { info?: { owner?: unknown; mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } : undefined;
    const info = parsed?.data?.parsed?.info; const token = info?.tokenAmount; const amount = token?.amount;
    if (parsed?.owner !== TOKEN_PROGRAM || info?.owner !== address || info?.mint !== DEVNET_USDC_MINT || token?.decimals !== 6 || typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error();
    return { amount, display: `${(Number(amount) / 1_000_000).toFixed(2)} test USDC`, available: true as const };
  } catch {
    return { amount: null, display: '暂时无法读取', available: false as const };
  }
}
