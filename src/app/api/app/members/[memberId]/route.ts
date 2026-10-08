import { z } from 'zod';
import { appRuntime } from '../../../../../modules/app/app-runtime';
import { ManagementApiError, managementRoute } from '../../../../../modules/app/management-auth';
import { smallJson } from '../../../../../modules/http/local-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ memberId: string }> };

async function memberId(context: Context) {
  return z.string().uuid().parse((await context.params).memberId);
}

export async function GET(request: Request, context: Context) {
  return managementRoute(request, false, async () => {
    const id = await memberId(context);
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    void app.refreshMainnetWallet();
    return Response.json(app.memberOverview(id), { headers: { 'cache-control': 'no-store' } });
  });
}

export async function PUT(request: Request, context: Context) {
  return managementRoute(request, true, async request => {
    const id = await memberId(context);
    const { label } = z.object({ label: z.string().trim().min(1).max(120) }).strict().parse(await smallJson(request));
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    if (!app.ledger.isCardMemberActive(id)) throw new ManagementApiError('CARD_MEMBER_NOT_ACTIVE', 409, '该 Agent 已撤销。');
    return Response.json(app.renameCardMember(id, label), { headers: { 'cache-control': 'no-store' } });
  });
}

export async function DELETE(request: Request, context: Context) {
  return managementRoute(request, true, async () => {
    const id = await memberId(context);
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    if (id === app.ledger.defaultCardMember().id) throw new ManagementApiError('DEFAULT_CARD_MEMBER_REQUIRED', 409, '默认 Agent 不能撤销。');
    if (!app.ledger.isCardMemberActive(id)) throw new ManagementApiError('CARD_MEMBER_NOT_ACTIVE', 409, '该 Agent 已撤销。');
    return Response.json(app.revokeCardMember(id), { headers: { 'cache-control': 'no-store' } });
  });
}
