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
    const code = ['REQUEST_ID_CONFLICT', 'PURCHASE_REQUEST_OWNER_MISMATCH', 'PURCHASE_EXECUTION_MODE_MISMATCH', 'LIVE_PAYMENT_EVIDENCE_INVALID',
      'SPEND_GRANT_INACTIVE', 'INVALID_X402_QUOTE', 'UNSUPPORTED_PURCHASE_NETWORK', 'INVALID_PURCHASE_ORIGIN'].includes(candidate) ? candidate : 'PURCHASE_REQUEST_FAILED';
    return Response.json({ code, error: '购买请求未执行付款。' }, { status: ['REQUEST_ID_CONFLICT', 'PURCHASE_REQUEST_OWNER_MISMATCH', 'PURCHASE_EXECUTION_MODE_MISMATCH', 'LIVE_PAYMENT_EVIDENCE_INVALID'].includes(code) ? 409 : 400 });
  }
}
