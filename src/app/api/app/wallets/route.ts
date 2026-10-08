import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return managementRoute(request, false, async () => Response.json({ wallets: await appRuntime().existingWallets() }));
}
