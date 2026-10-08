import { z } from 'zod';
import { appRuntime } from '../../../../modules/app/app-runtime';
import { managementRoute } from '../../../../modules/app/management-auth';
import { smallJson } from '../../../../modules/http/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return managementRoute(request, false, async () => {
    const app = appRuntime();
    void app.refreshMainnetWallet();
    return Response.json({ members: app.membersOverview() }, { headers: { 'cache-control': 'no-store' } });
  });
}

export async function POST(request: Request) {
  return managementRoute(request, true, async request => {
    const { label } = z.object({ label: z.string().trim().min(1).max(120) }).strict().parse(await smallJson(request));
    return Response.json(appRuntime().createCardMember(label), { status: 201, headers: { 'cache-control': 'no-store' } });
  });
}
