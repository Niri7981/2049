import { resourceManagement } from '@/modules/app/resource-management';
import { MAX_RESOURCE_ENTRY_BYTES } from '@/modules/http/request-size-limits';
import { z } from 'zod';
import { appRuntime } from '../../../../../../modules/app/app-runtime';
import { ManagementApiError, managementRoute } from '../../../../../../modules/app/management-auth';
import { smallJson } from '../../../../../../modules/http/local-request';
import { SpendGrantInputSchema } from '../../../../../../modules/authority/spend-grant';
import { ResourceRequestInputSchema } from '../../../../../../modules/resources/http-resource';

export const runtime = 'nodejs';
type Context = { params: Promise<{ memberId: string }> };
const RequestSchema = z.discriminatedUnion('action', [
  SpendGrantInputSchema.extend({ action: z.literal('create'), resourceId: z.string().min(1).max(200).optional(), sample: ResourceRequestInputSchema.optional(), postApprovalHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('revoke'), resourceId: z.string().min(1).max(200).optional() }).strict(),
]);

export async function PUT(request: Request, context: Context) {
  return managementRoute(request, true, async request => {
    const id = z.string().uuid().parse((await context.params).memberId);
    const input = RequestSchema.parse(await smallJson(request, MAX_RESOURCE_ENTRY_BYTES));
    const app = appRuntime();
    if (!app.ledger.cardMember(id)) throw new ManagementApiError('CARD_MEMBER_NOT_FOUND', 404, '找不到该 Agent。');
    if (!app.ledger.isCardMemberActive(id)) throw new ManagementApiError('CARD_MEMBER_NOT_ACTIVE', 409, '该 Agent 已撤销。');
    if (input.action === 'revoke') app.revokeSpendGrant(id, input.resourceId);
    else await resourceManagement(() => app.createSpendGrant({ totalLimit: input.totalLimit, singleLimit: input.singleLimit, expiresAt: input.expiresAt,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}), ...(input.sample ? { sample: input.sample } : {}), ...(input.postApprovalHash ? { postApprovalHash: input.postApprovalHash } : {}) }, id));
    const member = app.memberOverview(id);
    return Response.json({ grant: member.grant, connection: member.connection }, { headers: { 'cache-control': 'no-store' } });
  }, MAX_RESOURCE_ENTRY_BYTES);
}
