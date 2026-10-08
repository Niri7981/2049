import { appRuntime } from '@/modules/app/app-runtime';
import { smallJson } from '@/modules/http/local-request';
import { ResourcePostApprovalError } from '@/modules/resources/post-request-authorization';
import { MAX_RESOURCE_ENTRY_BYTES } from '@/modules/http/request-size-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const app = appRuntime();
  let principal;
  try { principal = app.authenticateAgent(request); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    const proposal = await app.discoverAgentResource(await smallJson(request, MAX_RESOURCE_ENTRY_BYTES), principal);
    return Response.json(proposal, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ResourcePostApprovalError) return Response.json({ code: error.code, error: 'Review the specific POST in Yosh before discovery; no request or payment was sent.' }, { status: 409 });
    return Response.json({ code: 'RESOURCE_DISCOVERY_UNAVAILABLE', error: 'No supported unpaid x402 quote was safely retrieved.' }, { status: 422 });
  }
}
