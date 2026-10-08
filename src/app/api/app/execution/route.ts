import { z } from 'zod';
import { appRuntime } from '@/modules/app/app-runtime';
import { managementRoute } from '@/modules/app/management-auth';
import { smallJson } from '@/modules/http/local-request';
import { PurchaseExecutionModeSchema } from '@/modules/payment/payment-environment';

const Input = z.union([
  z.object({ mode: PurchaseExecutionModeSchema }).strict(),
  z.object({ productionExecutionEnabled: z.boolean() }).strict(),
]);
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return managementRoute(request, false, async () => Response.json(appRuntime().execution()));
}
export async function PUT(request: Request) {
  return managementRoute(request, true, async verified => {
    const input = Input.parse(await smallJson(verified));
    return Response.json('mode' in input ? appRuntime().setExecution(input.mode)
      : appRuntime().setProductionExecutionEnabled(input.productionExecutionEnabled));
  });
}
