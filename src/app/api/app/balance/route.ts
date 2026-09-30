import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return managementRoute(request, false, async () => {
    const app = appRuntime();
    const wallet = await app.initializeWallet();
    return Response.json({ balance: await app.balance(wallet.address) }, { headers: { 'cache-control': 'no-store' } });
  });
}
