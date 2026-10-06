import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/http/local-request';
import { SpendGrantInputSchema } from '@/modules/authority/spend-grant';

export const runtime = 'nodejs';

const RequestSchema = z.discriminatedUnion('action', [
  SpendGrantInputSchema.extend({ action: z.literal('create'), resourceId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
]);

export async function PUT(request: Request) {
  return managementRoute(request, true, async request => {
    const input = RequestSchema.parse(await smallJson(request));
    const app = appRuntime();
    if (input.action === 'revoke') app.revokeSpendGrant();
    else app.createSpendGrant({ totalLimit: input.totalLimit, singleLimit: input.singleLimit, expiresAt: input.expiresAt, ...(input.resourceId ? { resourceId: input.resourceId } : {}) });
    return Response.json({ grant: app.spendGrantSummary(), connection: app.agentConnection.status() });
  });
}
