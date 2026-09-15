import { managementError, requireManagementRequest } from '@/modules/app/management-auth';
import { appRuntime } from '@/modules/app/app-runtime';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { requireManagementRequest(request); void appRuntime().start(new URL(request.url).origin).catch(() => undefined); return Response.json({ ready: true }); }
  catch (error) { return managementError(error); }
}
