import { appRuntime } from '@/modules/app/app-runtime';
import { localRequestOrigin, smallJson } from '@/modules/demo/local-request';
import { PurchaseRequestInputSchema } from '@/modules/purchases/request-market-purchase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const app = appRuntime();
  let principal;
  try { principal = app.agentConnection.authenticate(request, 'request_purchase'); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    const input = PurchaseRequestInputSchema.parse(await smallJson(request));
    return Response.json(await app.requestPurchase(input, localRequestOrigin(request), principal), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const candidate = error instanceof Error ? error.message : '';
    const code = ['REQUEST_ID_CONFLICT', 'PURCHASE_REQUEST_OWNER_MISMATCH', 'SPEND_GRANT_INACTIVE', 'INVALID_X402_QUOTE',
      'UNSUPPORTED_PURCHASE_NETWORK', 'INVALID_PURCHASE_ORIGIN'].includes(candidate) ? candidate : 'PURCHASE_REQUEST_FAILED';
    return Response.json({ code, error: '购买请求未执行付款。' }, { status: code === 'REQUEST_ID_CONFLICT' || code === 'PURCHASE_REQUEST_OWNER_MISMATCH' ? 409 : 400 });
  }
}
