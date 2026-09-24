import { appRuntime } from '@/modules/app/app-runtime';
import { readMarketQuote } from '@/modules/purchases/market-quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const app = appRuntime();
  try { app.agentConnection.authenticate(request); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].length !== 1) return Response.json({ code: 'INVALID_OPERATION' }, { status: 400 });
    const operation = query.get('operation');
    if (operation === 'status') {
      const overview = await app.overview();
      return Response.json({ wallet: overview.wallet, budget: overview.budget, grant: overview.grant,
        spendingAuthorized: overview.connection.enabled && overview.grant?.status === 'ACTIVE',
        paymentEnabled: overview.service.purchaseMode === 'live_devnet' }, { headers: { 'cache-control': 'no-store' } });
    }
    if (operation !== 'quote') return Response.json({ code: 'UNKNOWN_OPERATION' }, { status: 400 });
    await app.initializeWallet();
    return Response.json(await readMarketQuote(new URL(request.url).origin), { headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ code: 'AGENT_READ_FAILED', error: '暂时无法读取；请求未付款。' }, { status: 503 }); }
}
