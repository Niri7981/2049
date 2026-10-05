import { realpathSync } from 'node:fs';
import { managementRoute } from '@/modules/app/management-auth';
import { appRuntime } from '@/modules/app/app-runtime';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return managementRoute(request, false, async () => {
    const backend = appRuntime();
    void backend.start(new URL(request.url).origin).catch(() => undefined);
    return Response.json({ ready: true, service: 'Yosh', pid: process.pid, dataDirectory: realpathSync(backend.directory) },
      { headers: { 'cache-control': 'no-store' } });
  });
}
