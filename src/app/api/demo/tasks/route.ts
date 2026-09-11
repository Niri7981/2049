import { spawn } from "node:child_process";
import { DemoInput, DemoStore } from "@/modules/demo/demo-store";
import { requireLocalRequest, smallJson } from "@/modules/demo/local-request";
import { PurchaseLedger } from "@/modules/purchases/purchase-ledger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    requireLocalRequest(request);
  } catch {
    return Response.json(
      { error: "只允许本机同源访问。" },
      { status: 403, headers },
    );
  }
  const store = new DemoStore();
  const ledger = new PurchaseLedger();
  try {
    store.recoverDeadRuns();
    ledger.releaseExpired();
    const id = new URL(request.url).searchParams.get("taskId");
    return Response.json(
      {
        task: (id ? store.get(id) : store.latest()) ?? null,
        budget: ledger.summary(),
      },
      { headers },
    );
  } finally {
    store.close();
    ledger.close();
  }
}
export async function POST(request: Request) {
  try {
    requireLocalRequest(request, true);
  } catch {
    return Response.json(
      { error: "只允许本机同源请求。" },
      { status: 403, headers },
    );
  }
  let input;
  try {
    input = DemoInput.parse(await smallJson(request));
  } catch {
    return Response.json(
      { error: "请输入有效的任务，最多 1000 字。" },
      { status: 400, headers },
    );
  }
  const store = new DemoStore();
  try {
    if (!process.env.OPENAI_API_KEY)
      return Response.json(
        { error: "请先配置模型 API。" },
        { status: 503, headers },
      );
    const launch = store.start(input);
    if (launch.started) {
      try {
        // Fixed worker entry; no caller-controlled command, path, URL or wallet parameter.
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--env-file-if-exists=.env.local",
            "scripts/task-worker.ts",
            input.taskId,
            launch.token,
          ],
          {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["ignore", "inherit", "ignore"],
            timeout: 240_000,
          },
        );
        const ended = () => {
          const s = new DemoStore();
          try {
            s.interrupted(input.taskId, launch.token);
          } finally {
            s.close();
          }
        };
        child.once("error", ended);
        child.once("exit", ended);
        if (child.pid) store.setPid(input.taskId, launch.token, child.pid);
        child.unref();
      } catch {
        store.interrupted(input.taskId, launch.token);
      }
    }
    return Response.json({ taskId: input.taskId }, { status: 202, headers });
  } catch {
    return Response.json(
      { error: "无法启动：请等待当前任务结束，并保持原任务内容不变。" },
      { status: 409, headers },
    );
  } finally {
    store.close();
  }
}
