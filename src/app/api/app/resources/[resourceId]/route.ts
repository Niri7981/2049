import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';
import { resourceManagement } from '@/modules/app/resource-management';
import { smallJson } from '@/modules/http/local-request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ resourceId: string }> };
const State = z.object({ state: z.enum(['DISABLED', 'REMOVED']) }).strict();
export async function GET(request: Request, context: Context) {
  return managementRoute(request, false, async () => resourceManagement(async () =>
    Response.json(appRuntime().inspectRegisteredResource((await context.params).resourceId))));
}
export async function PUT(request: Request, context: Context) {
  return managementRoute(request, true, async verified => resourceManagement(async () => {
    const { state } = State.parse(await smallJson(verified));
    return Response.json(appRuntime().disableRegisteredResource((await context.params).resourceId, state));
  }));
}
