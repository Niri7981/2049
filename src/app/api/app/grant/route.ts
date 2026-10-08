import { resourceManagement } from '@/modules/app/resource-management';
import { MAX_RESOURCE_ENTRY_BYTES } from '@/modules/http/request-size-limits';
import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/http/local-request';
import { SpendGrantInputSchema } from '@/modules/authority/spend-grant';
import { ResourceRequestInputSchema } from '@/modules/resources/http-resource';

export const runtime = 'nodejs';

const RequestSchema = z.discriminatedUnion('action', [
  SpendGrantInputSchema.extend({ action: z.literal('create'), resourceId: z.string().min(1).max(200).optional(), sample: ResourceRequestInputSchema.optional(), postApprovalHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('revoke'), resourceId: z.string().min(1).max(200).optional() }).strict(),
]);

export async function PUT(request: Request) {
  return managementRoute(request, true, async request => {
    const input = RequestSchema.parse(await smallJson(request, MAX_RESOURCE_ENTRY_BYTES));
    const app = appRuntime();
    if (input.action === 'revoke') app.revokeSpendGrant(undefined, input.resourceId);
    else await resourceManagement(() => app.createSpendGrant({ totalLimit: input.totalLimit, singleLimit: input.singleLimit, expiresAt: input.expiresAt,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}), ...(input.sample ? { sample: input.sample } : {}), ...(input.postApprovalHash ? { postApprovalHash: input.postApprovalHash } : {}) }));
    return Response.json({ grant: app.spendGrantSummary(), connection: app.agentConnection.status() });
  }, MAX_RESOURCE_ENTRY_BYTES);
}
