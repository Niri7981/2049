import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/demo/local-request';

const Input = z.object({ action: z.literal('prepareQuit') }).strict();
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { requireManagementRequest(request, true); Input.parse(await smallJson(request)); await appRuntime().prepareQuit(); return Response.json({ ready: true }); }
  catch (error) { return managementError(error); }
}
