import { appRuntime } from '@/modules/app/app-runtime';
import { managementError, requireManagementRequest } from '@/modules/app/management-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { requireManagementRequest(request); return Response.json(await appRuntime().overview(), { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { return managementError(error); }
}
