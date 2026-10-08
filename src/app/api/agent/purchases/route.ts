import { MAX_RESOURCE_ENTRY_BYTES } from '@/modules/http/request-size-limits';
import { appRuntime } from '@/modules/app/app-runtime';
import { localRequestOrigin, smallJson } from '@/modules/http/local-request';
import { PurchaseRequestInputSchema } from '@/modules/purchases/request-paid-resource-purchase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const app = appRuntime();
  let principal;
  try { principal = app.authenticateAgent(request, 'request_purchase'); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    const input = PurchaseRequestInputSchema.parse(await smallJson(request, MAX_RESOURCE_ENTRY_BYTES));
    return Response.json(await app.requestPurchase(input, localRequestOrigin(request), principal), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const candidate = error instanceof Error ? ('code' in error && typeof error.code === 'string' ? error.code : error.message) : '';
    const code = ['REQUEST_ID_CONFLICT', 'PURCHASE_REQUEST_OWNER_MISMATCH', 'PURCHASE_EXECUTION_MODE_MISMATCH', 'LIVE_PAYMENT_EVIDENCE_INVALID',
      'SPEND_GRANT_INACTIVE', 'INVALID_X402_QUOTE', 'UNSUPPORTED_PURCHASE_NETWORK', 'INVALID_PURCHASE_ORIGIN', 'MAINNET_REGISTERED_RESOURCE_REQUIRED', 'MAINNET_EXECUTION_DISABLED',
      'RESOURCE_POST_APPROVAL_REQUIRED', 'RESOURCE_REQUEST_INPUT_INVALID', 'RESOURCE_REQUEST_INPUT_REQUIRED', 'RESOURCE_REQUEST_INPUT_UNSUPPORTED'].includes(candidate) ? candidate : 'PURCHASE_REQUEST_FAILED';
    return Response.json({ code, error: '购买请求未完成；请查询原购买编号的状态。' }, { status: ['REQUEST_ID_CONFLICT', 'PURCHASE_REQUEST_OWNER_MISMATCH', 'PURCHASE_EXECUTION_MODE_MISMATCH', 'LIVE_PAYMENT_EVIDENCE_INVALID'].includes(code) ? 409 : 400 });
  }
}
