import {
  paidMarketSnapshotResponse,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RECOVERY_HEADER,
} from "@/modules/paid-market-api/paid-market-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (![1, 2].includes([...query.keys()].length) || !query.has("asset") || ([...query.keys()].length === 2 && !query.has("offer"))) {
    return Response.json({ error: "Asset and optional offer parameters are required" }, { status: 400 });
  }
  const asset = query.get("asset");
  const offer = query.get("offer") ?? undefined;
  return paidMarketSnapshotResponse({ asset, ...(offer ? { offer } : {}) }, request.headers.get(PAYMENT_SIGNATURE_HEADER) ?? undefined, request.headers.get(PAYMENT_RECOVERY_HEADER) === "1");
}
