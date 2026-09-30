import { z } from 'zod';
import { appRuntime } from '../../../../../../modules/app/app-runtime';
import { ManagementApiError, managementRoute } from '../../../../../../modules/app/management-auth';
import { smallJson } from '../../../../../../modules/http/local-request';
import { SpendGrantInputSchema } from '../../../../../../modules/authority/spend-grant';

export const runtime = 'nodejs';
type Context = { params: Promise<{ memberId: string }> };
const RequestSchema = z.discriminatedUnion('action', [
  SpendGrantInputSchema.extend({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
]);

export async function PUT(request: Request, context: Context) {
  return managementRoute(request, true, async request => {
    const id = z.string().uuid().parse((await context.params).memberId);
    const input = RequestSchema.parse(await smallJson(request));
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    if (!app.ledger.isCardMemberActive(id)) throw new ManagementApiError('CARD_MEMBER_NOT_ACTIVE', 409, '该 Agent 已撤销。');
    if (input.action === 'revoke') app.revokeSpendGrant(id);
    else app.createSpendGrant({ totalLimit: input.totalLimit, singleLimit: input.singleLimit, expiresAt: input.expiresAt }, id);
    const member = app.memberOverview(id);
    return Response.json({ grant: member.grant, connection: member.connection }, { headers: { 'cache-control': 'no-store' } });
  });
}
