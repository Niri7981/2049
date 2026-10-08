import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { smallJson } from '@/modules/http/local-request';
import { ResourceRegistryError } from '@/modules/resources/runtime-resource-registry';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Agent authentication only opens this creation service; never forwards to management routes. */
export async function POST(request: Request) {
  const app = appRuntime();
  let principal;
  try { principal = app.authenticateAgent(request); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    return Response.json(app.registerAgentResource(await smallJson(request), principal),
      { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ code: error instanceof ResourceRegistryError ? error.code
      : error instanceof z.ZodError ? 'RESOURCE_REGISTRATION_INPUT_INVALID' : 'RESOURCE_REGISTRATION_UNAVAILABLE',
    error: 'Registration was rejected. No spending permission or payment was created.' },
    { status: error instanceof z.ZodError ? 400 : 409 });
  }
}
