import { z } from 'zod';
import { appRuntime } from '../../../../modules/app/app-runtime';
import { managementError, requireManagementRequest } from '../../../../modules/app/management-auth';
import { smallJson } from '../../../../modules/http/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    requireManagementRequest(request);
    return Response.json({ members: appRuntime().membersOverview() }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return managementError(error); }
}

export async function POST(request: Request) {
  try {
    requireManagementRequest(request, true);
    const { label } = z.object({ label: z.string().trim().min(1).max(120) }).strict().parse(await smallJson(request));
    return Response.json(appRuntime().createCardMember(label), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) { return managementError(error); }
}
