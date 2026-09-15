import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/demo/local-request';

const Input = z.union([
  z.object({ dailyLimit: z.string().regex(/^\d{1,15}$/).nullable() }).strict(),
  z.object({ paused: z.boolean() }).strict(),
]);
export const runtime = 'nodejs';
export async function PUT(request: Request) {
  try {
    requireManagementRequest(request, true);
    const input = Input.parse(await smallJson(request));
    const settings = 'dailyLimit' in input ? appRuntime().setDailyLimit(input.dailyLimit) : appRuntime().setPaused(input.paused);
    return Response.json({ settings });
  } catch (error) { return managementError(error); }
}
