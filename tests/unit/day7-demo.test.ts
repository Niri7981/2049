import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoStore, safeText } from "../../src/modules/demo/demo-store";
import {
  requireLocalRequest,
  smallJson,
} from "../../src/modules/demo/local-request";

afterEach(() => vi.unstubAllEnvs());
function request(
  headers: Record<string, string> = {},
  url = "http://localhost:3000/api/demo/tasks",
) {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}
describe("Day 7 local wallet boundary", () => {
  it("accepts Next normalized localhost with the real loopback Host and matching Origin", () => {
    expect(() => requireLocalRequest(request(), true)).not.toThrow();
  });
  it.each<Record<string, string>>([
    { host: "evil.example:3000" },
    { host: "127.0.0.1:4000" },
    { host: "evil@127.0.0.1:3000" },
    { origin: "https://evil.example" },
    { origin: "http://localhost:3000" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
    { "content-type": "text/plain" },
  ])("rejects cross-site or malformed browser authority %j", (headers) => {
    expect(() => requireLocalRequest(request(headers), true)).toThrow();
  });
  it("rejects public and encrypted request URLs, even with local Host", () => {
    for (const url of ["http://evil.example:3000/", "https://localhost:3000/"])
      expect(() => requireLocalRequest(request({}, url), true)).toThrow();
  });
  it("requires a mutation Origin but permits a local read without it", () => {
    const r = request();
    r.headers.delete("origin");
    expect(() => requireLocalRequest(r, true)).toThrow();
    expect(() => requireLocalRequest(r)).not.toThrow();
  });
  it("bounds the bytes actually streamed, independent of Content-Length", async () => {
    const r = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ task: "汉".repeat(3000) }),
      headers: { "content-length": "2" },
    });
    await expect(smallJson(r)).rejects.toThrow("过长");
    await expect(smallJson(request())).resolves.toEqual({});
    await expect(
      smallJson(
        new Request("http://localhost", { method: "POST", body: "{bad" }),
      ),
    ).rejects.toThrow();
  });
});
describe("Day 7 durable execution", () => {
  it("emits exactly the committed public event to both console and page", () => {
    const sink = vi.fn();
    const store = new DemoStore(":memory:", sink);
    try {
      const run = store.start({ taskId: "trace", task: "SOL" });
      store.event("trace", run.token, "QUOTE_RECEIVED", "0.01 测试 USDC");
      expect(sink.mock.calls.map(([event]) => event)).toEqual(store.get("trace")?.events);
      expect(store.get("trace")?.events[1]).toMatchObject({ eventId: "trace:2", taskId: "trace", actor: "API", status: "success" });
    } finally { store.close(); }
  });
  it("serializes workers across connections and keeps task contents immutable", () => {
    const dir = mkdtempSync(join(tmpdir(), "day7-"));
    const a = new DemoStore(join(dir, "trace.sqlite"));
    const b = new DemoStore(join(dir, "trace.sqlite"));
    try {
      const first = a.start({ taskId: "one", task: "SOL" });
      a.setPid("one", first.token, process.pid);
      expect(b.start({ taskId: "one", task: "SOL" }).started).toBe(false);
      expect(() => b.start({ taskId: "one", task: "BTC" })).toThrow();
      expect(() => b.start({ taskId: "two", task: "SOL" })).toThrow();
      a.event("one", first.token, "PLANNING");
      expect(b.get("one")?.events.map((e) => e.sequence)).toEqual([1, 2]);
      a.finish("one", first.token, "COMPLETE", {
        status: "PAID",
        reused: false,
      });
      expect(b.start({ taskId: "two", task: "SOL" }).started).toBe(true);
    } finally {
      a.close();
      b.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("preserves interrupted history while fencing stale workers from a resumed task", () => {
    const store = new DemoStore(":memory:");
    try {
      const old = store.start({ taskId: "one", task: "SOL" });
      store.setPid("one", old.token, process.pid);
      store.recoverDeadRuns(() => false);
      expect(store.get("one")?.status).toBe("PAUSED");
      const fresh = store.start({ taskId: "one", task: "SOL" });
      store.event("one", old.token, "FAILED");
      store.interrupted("one", old.token);
      store.finish("one", old.token, "COMPLETE", {
        status: "PAID",
        reused: false,
      });
      expect(store.owns("one", fresh.token)).toBe(true);
      expect(store.get("one")?.events.map((e) => e.type)).toEqual([
        "TASK_STARTED",
        "INTERRUPTED",
        "TASK_STARTED",
      ]);
      expect(JSON.stringify(store.get("one"))).not.toContain(fresh.token);
      expect(store.get("one")).not.toHaveProperty("pid");
    } finally {
      store.close();
    }
  });
  it("rejects secrets in task text and redacts events before persistence", () => {
    vi.stubEnv("OPENAI_API_KEY", "custom-secret-123456789");
    const store = new DemoStore(":memory:");
    try {
      expect(() =>
        store.start({ taskId: "one", task: "custom-secret-123456789" }),
      ).toThrow();
      const run = store.start({ taskId: "one", task: "SOL" });
      store.event(
        "one",
        run.token,
        "FAILED",
        "custom-secret-123456789 sk-fake1234567890 Bearer abcdef",
      );
      expect(store.get("one")?.events[1].detail).toBe(
        "[已隐藏] [已隐藏] [已隐藏]",
      );
      expect(safeText("normal SOL task")).toBe("normal SOL task");
    } finally {
      store.close();
    }
  });
});
