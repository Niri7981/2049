import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/demo/local-request';

export const runtime = 'nodejs';
export async function PUT(request: Request) {
  try {
    requireManagementRequest(request, true);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await smallJson(request));
    const app = appRuntime();
    return Response.json({ connection: app.setAgentConnection(enabled, new URL(request.headers.get('origin')!).origin) });
  } catch (error) { return managementError(error); }
}
