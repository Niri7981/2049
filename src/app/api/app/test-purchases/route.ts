import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/demo/local-request';

const Input = z.object({ purchaseId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) }).strict();
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireManagementRequest(request, true);
    const input = Input.parse(await smallJson(request));
    const url = new URL(request.url);
    const result = await appRuntime().createTestPurchase(input.purchaseId, url.origin);
    return Response.json({ purchase: result });
  } catch (error) { return managementError(error); }
}
