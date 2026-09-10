import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  executionEvent,
  type TraceType,
  type DemoTask,
  type DemoResult,
  type DemoEvent,
} from "./trace";

export const DemoInput = z
  .object({
    taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    task: z.string().trim().min(1).max(1000),
  })
  .strict();
export function safeText(input: string) {
  let text = input;
  for (const secret of [
    process.env.OPENAI_API_KEY,
    process.env.DEMO_BUYER_PRIVATE_KEY,
  ])
    if (secret && secret.length > 8) text = text.replaceAll(secret, "[已隐藏]");
  return text
    .replace(/sk-[\w-]{12,}/g, "[已隐藏]")
    .replace(/Bearer\s+[^\s"']+/gi, "[已隐藏]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
/** This database contains only task text, allowlisted public results and safe events. */
export class DemoStore {
  private db: DatabaseSync;
  private pending: DemoEvent[] = [];
  constructor(
    path = ".data/day7-demo.sqlite",
    private sink: (event: DemoEvent) => void = (event) =>
      console.log(JSON.stringify(event)),
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS demo_tasks (task_id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, token TEXT NOT NULL, pid INTEGER, result TEXT);
      CREATE TABLE IF NOT EXISTS demo_events (task_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(task_id,sequence));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.pending = [];
      this.db.exec("ROLLBACK");
      throw e;
    }
    const events = this.pending;
    this.pending = [];
    for (const event of events) {
      try {
        this.sink(event);
      } catch {
        /* Committed history survives a broken console. */
      }
    }
    return result;
  }
  private append(taskId: string, type: TraceType, detail = "") {
    const at = Date.now();
    const safeDetail = safeText(detail).slice(0, 300);
    this.db
      .prepare(
        "INSERT INTO demo_events SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,? FROM demo_events WHERE task_id=?",
      )
      .run(taskId, type, at, safeDetail, taskId);
    const row = this.db
      .prepare(
        "SELECT MAX(sequence) AS sequence FROM demo_events WHERE task_id=?",
      )
      .get(taskId)!;
    this.pending.push(
      executionEvent(taskId, Number(row.sequence), type, at, safeDetail),
    );
  }
  event(taskId: string, token: string, type: TraceType, detail = "") {
    this.atomic(() => {
      if (this.owns(taskId, token)) this.append(taskId, type, detail);
    });
  }
  owns(taskId: string, token: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM demo_tasks WHERE task_id=? AND token=? AND status='RUNNING'",
        )
        .get(taskId, token),
    );
  }
  recoverDeadRuns(
    isAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  ) {
    for (const row of this.db
      .prepare(
        "SELECT task_id,token,pid,created_at FROM demo_tasks WHERE status='RUNNING'",
      )
      .all()) {
      if (
        row.pid
          ? !isAlive(Number(row.pid))
          : Date.now() - Number(row.created_at) > 15000
      )
        this.interrupted(String(row.task_id), String(row.token));
    }
  }
  start(raw: unknown) {
    const input = DemoInput.parse(raw);
    if (safeText(input.task) !== input.task)
      throw new Error("任务中不能包含密钥或访问凭证。");
    this.recoverDeadRuns();
    return this.atomic(() => {
      const existing = this.db
        .prepare("SELECT * FROM demo_tasks WHERE task_id=?")
        .get(input.taskId);
      if (existing && existing.task !== input.task)
        throw new Error("同一任务编号不能更换内容，请恢复原任务。");
      if (existing?.status === "RUNNING") return { started: false, token: "" };
      if (
        this.db
          .prepare("SELECT 1 FROM demo_tasks WHERE status='RUNNING' LIMIT 1")
          .get()
      )
        throw new Error("已有任务正在运行，请等待它完成。");
      const token = randomUUID();
      this.db
        .prepare(
          "INSERT INTO demo_tasks (task_id,task,status,created_at,token) VALUES (?,?,'RUNNING',?,?) ON CONFLICT(task_id) DO UPDATE SET status='RUNNING',created_at=excluded.created_at,token=excluded.token,pid=NULL",
        )
        .run(input.taskId, input.task, Date.now(), token);
      this.append(input.taskId, "TASK_STARTED");
      return { started: true, token };
    });
  }
  setPid(taskId: string, token: string, pid: number) {
    this.db
      .prepare(
        "UPDATE demo_tasks SET pid=? WHERE task_id=? AND token=? AND status='RUNNING'",
      )
      .run(pid, taskId, token);
  }
  finish(
    taskId: string,
    token: string,
    status: DemoTask["status"],
    result: DemoResult,
  ) {
    this.db
      .prepare(
        "UPDATE demo_tasks SET status=?,result=? WHERE task_id=? AND token=? AND status='RUNNING'",
      )
      .run(status, JSON.stringify(result), taskId, token);
  }
  interrupted(taskId: string, token: string) {
    this.atomic(() => {
      if (!this.owns(taskId, token)) return;
      this.append(taskId, "INTERRUPTED");
      this.db
        .prepare(
          "UPDATE demo_tasks SET status='PAUSED' WHERE task_id=? AND token=?",
        )
        .run(taskId, token);
    });
  }
  get(taskId: string): DemoTask | undefined {
    const row = this.db
      .prepare("SELECT * FROM demo_tasks WHERE task_id=?")
      .get(taskId);
    if (!row) return;
    const events = this.db
      .prepare(
        "SELECT sequence,type,at,detail FROM demo_events WHERE task_id=? ORDER BY sequence",
      )
      .all(taskId)
      .map((e) =>
        executionEvent(
          taskId,
          Number(e.sequence),
          e.type as TraceType,
          Number(e.at),
          String(e.detail),
        ),
      );
    return {
      taskId,
      task: safeText(String(row.task)),
      status: row.status as DemoTask["status"],
      createdAt: Number(row.created_at),
      events: events as DemoEvent[],
      ...(row.result ? { result: JSON.parse(String(row.result)) } : {}),
    };
  }
  latest() {
    const row = this.db
      .prepare(
        "SELECT task_id FROM demo_tasks ORDER BY created_at DESC LIMIT 1",
      )
      .get();
    return row ? this.get(String(row.task_id)) : undefined;
  }
  close() {
    this.db.close();
  }
}
