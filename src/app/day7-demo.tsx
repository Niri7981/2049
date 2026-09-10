"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DemoTask } from "@/modules/demo/trace";
import type { DemoPreflight } from "@/modules/demo/preflight";
const example = "根据价格、成交量和 RSI 分析 SOL 市场情况";
type Budget = {
  paidUSDC: number;
  reservedUSDC: number;
  remainingUSDC: number;
  unresolved: number;
};
const time = (n: number) =>
  new Date(n).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const money = (n?: number) => (n === undefined ? "—" : n.toFixed(2));
function richText(text: string) {
  const bold = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) =>
      /^#{1,4} /.test(line) ? (
        <h3 key={i}>{bold(line.replace(/^#{1,4} /, ""))}</h3>
      ) : (
        <p key={i}>{bold(line.replace(/^- /, "• "))}</p>
      ),
    );
}
export function Day7Demo() {
  const [draft, setDraft] = useState(example);
  const [current, setCurrent] = useState<DemoTask | null>(null);
  const [budget, setBudget] = useState<Budget>();
  const [taskId, setTaskId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const [preflight, setPreflight] = useState<DemoPreflight>();
  const [checking, setChecking] = useState(false);
  const selected = useRef("");
  const running = sending || current?.status === "RUNNING";
  useEffect(() => {
    let stopped = false;
    const requested = new URLSearchParams(location.search).get("taskId");
    selected.current =
      requested && /^[a-zA-Z0-9_-]{1,80}$/.test(requested)
        ? requested
        : localStorage.getItem("2049-task") || "";
    if (selected.current) setTaskId(selected.current);
    async function refresh() {
      const requestedId = selected.current;
      try {
        const response = await fetch(
          "/api/demo/tasks" +
            (requestedId ? `?taskId=${encodeURIComponent(requestedId)}` : ""),
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error();
        const body = (await response.json()) as {
          task: DemoTask | null;
          budget: Budget;
        };
        if (stopped || selected.current !== requestedId) return;
        setConnected(true);
        setBudget(body.budget);
        if (body.task) {
          setCurrent(body.task);
          setDraft(body.task.task);
          setTaskId(body.task.taskId);
          selected.current = body.task.taskId;
          localStorage.setItem("2049-task", body.task.taskId);
        } else if (!selected.current) {
          const id = `web-${crypto.randomUUID()}`;
          selected.current = id;
          setTaskId(id);
        }
      } catch {
        if (!stopped) setConnected(false);
      }
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (running || !taskId || !draft.trim()) return;
    setSending(true);
    setError("");
    localStorage.setItem("2049-task", taskId);
    selected.current = taskId;
    try {
      const response = await fetch("/api/demo/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, task: current?.task || draft }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "暂时无法启动，请恢复原任务。");
      const next = await fetch(
        `/api/demo/tasks?taskId=${encodeURIComponent(taskId)}`,
        { cache: "no-store" },
      ).then((r) => r.json());
      if (next.task) setCurrent(next.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接中断，请恢复原任务。");
    } finally {
      setSending(false);
    }
  }
  function newTask() {
    if (running) return;
    const id = `web-${crypto.randomUUID()}`;
    selected.current = id;
    setTaskId(id);
    localStorage.setItem("2049-task", id);
    history.replaceState(
      null,
      "",
      `${location.pathname}?taskId=${encodeURIComponent(id)}`,
    );
    setCurrent(null);
    setDraft(example);
    setError("");
  }
  async function check() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/demo/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPreflight(body);
    } catch {
      setError("环境检查未完成，请确认本机服务已启动。");
    } finally {
      setChecking(false);
    }
  }
  const result = current?.result;
  const stateLabel = running
    ? "正在执行"
    : current?.status === "COMPLETE"
      ? "任务已完成"
      : current?.status === "PAUSED"
        ? "等待恢复"
        : current?.status === "NO_PURCHASE"
          ? "未购买数据"
          : "等待任务";
  return (
    <main className="demo-shell">
      <header className="topbar">
        <Link className="wordmark" href="/">
          2049<span> / Agent Payments</span>
        </Link>
        <div className="network">
          <i />
          Solana Devnet<span className="local-tag">本机演示</span>
        </div>
      </header>
      <section className="intro">
        <p className="kicker">AUTONOMOUS AGENT · DEMO 07</p>
        <h1>
          让 Agent 为完成任务，
          <br />
          <span>购买它需要的能力。</span>
        </h1>
        <p className="intro-copy">
          从发现数据到自主付款，每一步都可追溯。你提出任务，Agent
          在预算内完成分析。
        </p>
      </section>
      <section className="budget-strip" aria-label="消费规则">
        <div>
          <span>本次数据价格</span>
          <strong>
            0.01 <small>测试 USDC</small>
          </strong>
        </div>
        <div>
          <span>今日已消费</span>
          <strong>
            {money(budget?.paidUSDC)} <small>/ 1.00 USDC</small>
          </strong>
        </div>
        <div>
          <span>剩余日预算</span>
          <strong>
            {money(budget?.remainingUSDC)} <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>单笔自动上限</span>
          <strong>
            0.10 <small>USDC</small>
          </strong>
        </div>
      </section>
      {!connected && (
        <div className="notice" role="status">
          连接暂时中断，正在自动恢复执行记录。请保留原任务，不要重复新建购买。
        </div>
      )}
      {!!budget?.unresolved && (
        <div className="notice">
          有 {budget.unresolved}{" "}
          笔付款尚未查清，新购买保持冻结。请恢复对应原任务。
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="workspace">
        <section className="input-panel" aria-labelledby="task-heading">
          <div className="section-label">
            <span>01 / YOUR TASK</span>
            <span>输入</span>
          </div>
          <h2 id="task-heading">这次想了解什么？</h2>
          <form onSubmit={run}>
            <label htmlFor="task">分析任务</label>
            <textarea
              id="task"
              maxLength={1000}
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!!current || running}
              required
            />
            <p className="input-note">
              本版支持 SOL 市场数据。任务确实需要时，自动购买一次。
            </p>
            <button
              className="primary"
              type="submit"
              disabled={running || !taskId || !draft.trim()}
            >
              {running
                ? "Agent 正在执行…"
                : current?.status === "COMPLETE"
                  ? "重新读取原任务"
                  : current
                    ? "恢复原任务"
                    : "开始任务"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          {current && (
            <button
              type="button"
              className="text-button"
              onClick={newTask}
              disabled={running}
            >
              新建另一个任务
            </button>
          )}
          <div className="data-note">
            <span>数据说明</span>
            <p>
              使用 2026-09-05 的固定历史演示快照，<strong>不是实时行情</strong>
              。支付发生在测试网络。
            </p>
          </div>
          <div className="preflight">
            <button
              type="button"
              className="check-button"
              onClick={check}
              disabled={checking || running}
            >
              {checking ? "正在检查…" : "检查演示环境"}
              <span>
                {preflight ? (preflight.ready ? "就绪 ✓" : "需处理 !") : "↗"}
              </span>
            </button>
            {preflight && (
              <ul>
                {preflight.checks.map((c) => (
                  <li key={c.label} className={c.status}>
                    <strong>
                      {c.status === "pass"
                        ? "✓"
                        : c.status === "notice"
                          ? "i"
                          : "!"}{" "}
                      {c.label}
                    </strong>
                    <p>{c.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="feed-panel" aria-labelledby="feed-heading">
          <div className="section-label">
            <span>02 / LIVE EXECUTION</span>
            <span className={running ? "live-state" : ""}>{stateLabel}</span>
          </div>
          <h2 id="feed-heading">每一步，都有依据。</h2>
          <p className="section-copy">真实模型 · 规则审批 · 链上确认</p>
          {current?.events.length ? (
            <ol className="feed" aria-live="polite" aria-relevant="additions">
              {current.events.map((e) => (
                <li
                  key={e.sequence}
                  className={
                    ["warning", "error"].includes(e.status)
                      ? "event-warning"
                      : ""
                  }
                >
                  <span className="event-index" title={e.actor}>
                    {String(e.sequence).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{e.title}</h3>
                    {e.detail && (
                      <p>
                        {e.type === "CHAIN_CONFIRMED" &&
                        /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(e.detail) ? (
                          <a
                            href={`https://explorer.solana.com/tx/${e.detail}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {e.detail.slice(0, 8)}…{e.detail.slice(-8)} ↗
                          </a>
                        ) : (
                          e.detail
                        )}
                      </p>
                    )}
                  </div>
                  <time>{time(e.at)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-feed">
              <span className="empty-mark">↳</span>
              <p>从一个任务开始。</p>
              <small>执行记录会在这里逐步出现，刷新页面也不会丢失。</small>
              <div className="route-hint">
                发现 API <span>→</span> 审批付款 <span>→</span> 使用数据
              </div>
            </div>
          )}
        </section>
        <section className="answer-panel" aria-labelledby="answer-heading">
          <div className="section-label">
            <span>03 / THE RESULT</span>
            <span>{current?.status === "COMPLETE" ? "已保存" : "结果"}</span>
          </div>
          <h2 id="answer-heading">回答与购买凭证</h2>
          {result?.answer ? (
            <>
              <div className="receipt">
                <div>
                  <span>{result.reused ? "本次复用" : "已购买数据"}</span>
                  <strong>
                    {result.reused ? "0.00" : money(result.amountUSDC)}{" "}
                    <small>测试 USDC</small>
                  </strong>
                </div>
                {result.transaction && (
                  <a
                    href={`https://explorer.solana.com/tx/${result.transaction}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看原交易 ↗
                  </a>
                )}
              </div>
              <div className="answer-text">{richText(result.answer)}</div>
              <p className="saved-note">
                回答已保存 · 同一任务重跑不会再次购买
              </p>
            </>
          ) : (
            <div className="empty-answer">
              <p>
                {current?.status === "NO_PURCHASE"
                  ? "这个任务没有使用支持的付费资源，因此没有付款。"
                  : current?.status === "PAUSED"
                    ? "流程已暂停。恢复原任务会复用已有付款或数据，不会盲目重付。"
                    : "数据购买并校验完成后，Agent 的分析会显示在这里。"}
              </p>
              {result?.summary && <p>{result.summary}</p>}
            </div>
          )}
        </section>
      </div>
      <footer>
        <span>2049 / CAPABILITY TO COMPLETION</span>
        <span>
          {current
            ? `任务 ${current.taskId}`
            : "固定资源 · 每任务最多购买一次 · 密钥不进入模型"}
        </span>
      </footer>
    </main>
  );
}
