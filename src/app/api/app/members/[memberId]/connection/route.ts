import { z } from 'zod';
import { appRuntime } from '../../../../../../modules/app/app-runtime';
import { ManagementApiError, managementRoute } from '../../../../../../modules/app/management-auth';
import { smallJson } from '../../../../../../modules/http/local-request';

export const runtime = 'nodejs';
type Context = { params: Promise<{ memberId: string }> };

export async function PUT(request: Request, context: Context) {
  return managementRoute(request, true, async request => {
    const id = z.string().uuid().parse((await context.params).memberId);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await smallJson(request));
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    if (!app.ledger.isCardMemberActive(id)) throw new ManagementApiError('CARD_MEMBER_NOT_ACTIVE', 409, '该 Agent 已撤销。');
    return Response.json({ connection: await app.setMemberConnection(enabled, new URL(request.headers.get('origin')!).origin, id) },
      { headers: { 'cache-control': 'no-store' } });
  });
}
