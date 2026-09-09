import {
  paidMarketSnapshotResponse,
  PAYMENT_SIGNATURE_HEADER,
} from "@/modules/paid-market-api/paid-market-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].length !== 1 || !query.has("asset")) {
    return Response.json({ error: "Exactly one asset parameter is required" }, { status: 400 });
  }
  const asset = query.get("asset");
  return paidMarketSnapshotResponse({ asset }, request.headers.get(PAYMENT_SIGNATURE_HEADER) ?? undefined);
}
