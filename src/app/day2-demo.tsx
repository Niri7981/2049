"use client";

import { FormEvent, useState } from "react";

import type { Day2DiscoveryRun } from "@/modules/agent/day2-agent-runtime";

const defaultTask = "使用专业市场数据分析一下 SOL 当前的市场情况。";

function formatPrice(minorUnits: number) {
  return (minorUnits / 1_000_000).toFixed(2);
}

export function Day2Demo() {
  const [task, setTask] = useState(defaultTask);
  const [result, setResult] = useState<Day2DiscoveryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const body = (await response.json()) as Day2DiscoveryRun | { error?: string };

      if (!response.ok || !("events" in body)) {
        throw new Error("error" in body ? body.error : "Discovery request failed");
      }

      setResult(body);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "运行失败，请重试。");
    } finally {
      setIsRunning(false);
    }
  }

  const resource = result?.discovery?.resource;

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Day 2 · Capability Discovery</p>
        <h1>Agent 找到它缺少的能力</h1>
        <p className="summary">
          今天只验证任务理解与 Tool Discovery。系统找到付费 API 后停止，不会发起付款。
        </p>
      </header>

      <section className="task-panel" aria-labelledby="task-heading">
        <div className="section-heading">
          <span className="step-number">01</span>
          <div>
            <h2 id="task-heading">提交任务</h2>
            <p>试试 SOL 市场分析、BTC 市场分析，或者一个不需要行情数据的任务。</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="agent-task">User Task</label>
          <textarea
            id="agent-task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            maxLength={1_000}
            rows={4}
            required
          />
          <div className="form-footer">
            <span>{task.length} / 1000</span>
            <button type="submit" disabled={isRunning || !task.trim()}>
              {isRunning ? "Agent 正在判断…" : "开始 Discovery"}
            </button>
          </div>
        </form>
      </section>

      {error ? <div className="error-message" role="alert">{error}</div> : null}

      {result ? (
        <div className="result-grid">
          <section className="trace-panel" aria-labelledby="trace-heading">
            <div className="section-heading compact">
              <span className="step-number">02</span>
              <div>
                <h2 id="trace-heading">Execution Trace</h2>
                <p>
                  Planner：
                  {result.planner_mode === "openai_agent"
                    ? "OpenAI Agent"
                    : "本地确定性演示模式"}
                </p>
              </div>
            </div>

            <ol className="trace-list">
              {result.events.map((event) => (
                <li key={event.sequence}>
                  <div className={`actor actor-${event.actor.toLowerCase()}`}>
                    {event.actor}
                  </div>
                  <div>
                    <p>{event.message}</p>
                    {Object.keys(event.details).length ? (
                      <dl>
                        {Object.entries(event.details).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="resource-panel" aria-labelledby="resource-heading">
            <span className="step-number">03</span>
            <h2 id="resource-heading">Discovery Result</h2>
            {resource ? (
              <>
                <div className="found-badge">Resource Found</div>
                <h3>{resource.name}</h3>
                <p>{resource.description}</p>
                <dl className="resource-details">
                  <div>
                    <dt>Capability</dt>
                    <dd>{resource.capability}</dd>
                  </div>
                  <div>
                    <dt>Expected price</dt>
                    <dd>{formatPrice(resource.expected_price_minor)} {resource.currency}</dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>Solana Devnet</dd>
                  </div>
                </dl>
                <div className="stop-notice">Day 2 在这里停止 · No payment</div>
              </>
            ) : (
              <div className="empty-result">
                <h3>No matching Resource</h3>
                <p>
                  {result.discovery?.reason ?? "Agent 判断这个任务不需要付费市场数据。"}
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
