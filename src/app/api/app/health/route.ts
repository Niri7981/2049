import { managementError, requireManagementRequest } from '@/modules/app/management-auth';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { requireManagementRequest(request); return Response.json({ ready: true }); }
  catch (error) { return managementError(error); }
}
