import { requireLocalRequest, smallJson } from "@/modules/demo/local-request";
import { runDemoPreflight } from "@/modules/demo/preflight";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireLocalRequest(request, true);
    await smallJson(request);
  } catch {
    return Response.json(
      { error: "只允许本机同源 JSON 请求。" },
      { status: 403 },
    );
  }
  try {
    return Response.json(await runDemoPreflight(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "检查未完成，请检查本机服务。" },
      { status: 503 },
    );
  }
}
