import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/demo/local-request';
import { SpendGrantInputSchema } from '@/modules/authority/spend-grant';

export const runtime = 'nodejs';

const RequestSchema = z.discriminatedUnion('action', [
  SpendGrantInputSchema.extend({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
]);

export async function PUT(request: Request) {
  try {
    requireManagementRequest(request, true);
    const input = RequestSchema.parse(await smallJson(request));
    const app = appRuntime();
    if (input.action === 'revoke') app.revokeSpendGrant();
    else app.createSpendGrant({ totalLimit: input.totalLimit, singleLimit: input.singleLimit, expiresAt: input.expiresAt });
    return Response.json({ grant: app.spendGrantSummary(), connection: app.agentConnection.status() });
  } catch (error) { return managementError(error); }
}
