import { paidMarketSnapshotResponse, PAYMENT_SIGNATURE_HEADER } from "@/modules/paid-market-api/paid-market-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset");
  return paidMarketSnapshotResponse({ asset }, request.headers.get(PAYMENT_SIGNATURE_HEADER) ?? undefined);
}
