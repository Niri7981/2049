import { MAX_RESOURCE_ENTRY_BYTES } from '@/modules/http/request-size-limits';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';
import { resourceManagement } from '@/modules/app/resource-management';
import { smallJson } from '@/modules/http/local-request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return managementRoute(request, false, async () => Response.json({ resources: appRuntime().listRegisteredResources() }));
}
export async function POST(request: Request) {
  return managementRoute(request, true, async verified => resourceManagement(async () =>
    Response.json(appRuntime().addRegisteredResource(await smallJson(verified, MAX_RESOURCE_ENTRY_BYTES)), { status: 201 })), MAX_RESOURCE_ENTRY_BYTES);
}
