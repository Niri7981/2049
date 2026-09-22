'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Overview = {
  connection: { enabled: boolean; lastSeen: number | null; access: 'read_only' | 'spending_request'; capabilities: Array<'read' | 'request_purchase'> };
  service: { status: string; network: string; testEnvironment: boolean; purchaseMode: 'simulated' | 'live_devnet' };
  wallet: { address: string; reused: boolean; balance: { amount: string | null; display: string; available: boolean } };
  budget: { day: string; timeZone: string; dailyLimit: string | null; paidDisplay: string; reservedDisplay: string; remainingDisplay: string; dailyLimitDisplay: string; paused: boolean; unresolved: number };
  grant: null | { id: string; status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'; totalLimit: string; singleLimit: string; committed: string; remaining: string; expiresAt: number; operation: string };
  purchases: Array<{ purchaseId: string; status: string; deliveryStatus: 'NOT_PAID' | 'PENDING' | 'COMPLETE'; amount: string; createdAt: number; transaction: string | null; offerId?: string; reason?: string; decisionReason?: string; grantId?: string }>;
};
type BridgeResponse = { ok: boolean; status: number; body: unknown };
declare global { interface Window { app2049?: { request(path: string, options?: { method?: string; body?: unknown }): Promise<BridgeResponse> } } }

function toMinor(input: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input)) throw new Error('请输入最多 6 位小数的 USDC 金额。');
  const [whole, fraction = ''] = input.split('.');
  const value = `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
  if (value.length > 15) throw new Error('额度过大。');
  return value;
}
function fromMinor(input: string | null) { return input === null ? '' : (Number(input) / 1_000_000).toString(); }
function decisionLabel(reason?: string) {
  if (!reason) return '';
  const labels: Record<string, string> = {
    AUTHORITY_BUDGET_AND_GRANT_PASSED: '授权、每日额度与报价检查通过',
    SPEND_GRANT_SINGLE_LIMIT_EXCEEDED: '超过授权单笔上限',
    SPEND_GRANT_TOTAL_LIMIT_EXCEEDED: '超过授权剩余额度',
    DAILY_BUDGET_EXCEEDED: '超过今日剩余额度',
    DAILY_LIMIT_NOT_SET: '尚未设置每日额度',
    PAYMENTS_PAUSED: '付款已暂停',
  };
  return labels[reason] ?? '策略未通过';
}
function defaultExpiry() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AppDashboard() {
  const [data, setData] = useState<Overview>();
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purchaseId, setPurchaseId] = useState(() => `app-${crypto.randomUUID()}`);
  const [grantTotal, setGrantTotal] = useState('5');
  const [grantSingle, setGrantSingle] = useState('0.5');
  const [grantExpiry, setGrantExpiry] = useState(defaultExpiry);
  const api = useCallback(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (!window.app2049) throw new Error('请从 2049 macOS App 打开此页面。');
    const response = await window.app2049.request(path, options);
    if (!response.ok) throw new Error((response.body as { error?: string }).error || '操作失败。');
    return response.body;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await api('/api/app/overview') as Overview;
      setData(next); setLimit(fromMinor(next.budget.dailyLimit)); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法连接本地服务。'); }
  }, [api]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  const purchaseLabel = useMemo(() => data?.service.purchaseMode === 'live_devnet' ? '执行 Devnet 测试购买' : '运行模拟测试购买', [data]);
  async function mutate(path: string, body: unknown) {
    setBusy(true); setError('');
    try { await api(path, { method: path.includes('test-purchases') ? 'POST' : 'PUT', body }); await refresh(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败。'); return false; }
    finally { setBusy(false); }
  }
  async function saveLimit() {
    try { await mutate('/api/app/settings', { dailyLimit: toMinor(limit) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '额度格式不正确。'); }
  }
  async function buy() {
    if (await mutate('/api/app/test-purchases', { purchaseId })) setPurchaseId(`app-${crypto.randomUUID()}`);
  }
  async function createGrant() {
    const expiresAt = new Date(grantExpiry).getTime();
    if (!Number.isFinite(expiresAt)) { setError('请选择有效的授权到期时间。'); return; }
    try { await mutate('/api/app/grant', { action: 'create', totalLimit: toMinor(grantTotal), singleLimit: toMinor(grantSingle), expiresAt }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '授权参数不正确。'); }
  }
  return <main className="app-shell">
    <header><div><p className="eyebrow">2049 · 本地购买服务</p><h1>消费钱包</h1></div><span className={data?.budget.paused ? 'pill warn' : 'pill'}>{data?.budget.paused ? '付款已暂停' : '服务运行中'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    <section><h2>钱包</h2><p className="address">{data?.wallet.address || '正在初始化…'}</p><div className="metric"><span>Devnet 余额</span><strong>{data?.wallet.balance.display || '—'}</strong></div><p className="hint">从 Phantom 等外部钱包向上方地址转入测试 USDC。私钥仅保存在 macOS 钥匙串。</p></section>
    <section><h2>每日共用额度</h2><div className="limit-row"><label><span>额度（test USDC）</span><input value={limit} onChange={event => setLimit(event.target.value)} placeholder="例如 1.00" inputMode="decimal" /></label><button disabled={busy} onClick={() => void saveLimit()}>保存额度</button></div>
      <div className="metrics"><div><span>今日已消费</span><strong>{data?.budget.paidDisplay || '—'}</strong></div><div><span>预占</span><strong>{data?.budget.reservedDisplay || '—'}</strong></div><div><span>剩余</span><strong>{data?.budget.remainingDisplay || '—'}</strong></div></div><p className="hint">{data ? `${data.budget.day} · ${data.budget.timeZone}` : '读取中…'}。修改额度不会清空今天的消费。</p>
      <button className="secondary" disabled={busy} onClick={() => void mutate('/api/app/settings', { paused: !data?.budget.paused })}>{data?.budget.paused ? '继续付款' : '暂停付款'}</button></section>
    <section><h2>Agent 连接</h2><p>{data?.connection.enabled ? (data.connection.access === 'spending_request' ? '已启用，消费授权已绑定' : '已启用，只读访问') : '未启用'}</p>
      <p className="hint">{data?.connection.lastSeen ? `最近收到请求：${new Date(data.connection.lastSeen).toLocaleString()}` : '尚未收到 Agent 请求。'} 创建或撤销消费授权会轮换连接凭据，需要重新启动 Agent 的 MCP 会话。</p>
      <button className="secondary" disabled={busy} onClick={() => void mutate('/api/app/connection', { enabled: !data?.connection.enabled })}>{data?.connection.enabled ? '撤销 Agent 连接' : '启用 Agent 连接'}</button></section>
    <section><h2>消费授权</h2>
      {data?.grant ? <div className="metrics"><div><span>状态</span><strong>{data.grant.status === 'ACTIVE' ? '有效' : data.grant.status === 'EXPIRED' ? '已到期' : '已撤销'}</strong></div><div><span>授权剩余</span><strong>{fromMinor(data.grant.remaining)} test USDC</strong></div><div><span>单笔上限</span><strong>{fromMinor(data.grant.singleLimit)} test USDC</strong></div></div> : <p className="hint">尚未创建消费授权。</p>}
      {data?.grant?.status === 'ACTIVE' && <p className="hint">到期：{new Date(data.grant.expiresAt).toLocaleString()}。仅适用于固定的 SOL 市场快照、Solana Devnet 和测试 USDC。</p>}
      <div className="limit-row"><label><span>授权总额（test USDC）</span><input value={grantTotal} onChange={event => setGrantTotal(event.target.value)} inputMode="decimal" /></label><label><span>单笔上限</span><input value={grantSingle} onChange={event => setGrantSingle(event.target.value)} inputMode="decimal" /></label></div>
      <label><span>到期时间</span><input type="datetime-local" value={grantExpiry} onChange={event => setGrantExpiry(event.target.value)} /></label>
      <div className="limit-row"><button disabled={busy || !data?.connection.enabled} onClick={() => void createGrant()}>{data?.grant?.status === 'ACTIVE' ? '替换授权' : '创建授权'}</button><button className="secondary" disabled={busy || data?.grant?.status !== 'ACTIVE'} onClick={() => void mutate('/api/app/grant', { action: 'revoke' })}>撤销授权</button></div>
    </section>
    <section><h2>测试购买</h2><p className="hint">仅限 Solana Devnet。默认模拟模式不会签名或提交交易；真实测试需要显式启用。</p><button disabled={busy || !data?.budget.dailyLimit || data?.budget.paused || data?.grant?.status !== 'ACTIVE'} onClick={() => void buy()}>{purchaseLabel}</button></section>
    <section><h2>购买记录</h2>{data?.purchases.length ? <ul className="records">{data.purchases.map(item => <li key={item.purchaseId}><div><strong>{item.status === 'PAID' ? '付款已确认' : item.status}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div>{item.reason && <span>{item.reason}</span>}<span>{item.deliveryStatus === 'COMPLETE' ? '结果已交付' : item.deliveryStatus === 'PENDING' ? '结果待恢复' : '付款未开始'}</span><code>{item.purchaseId}</code><span>{item.offerId ? `${item.offerId} · ` : ''}{(Number(item.amount) / 1_000_000).toFixed(2)} test USDC</span>{item.decisionReason && <span>{decisionLabel(item.decisionReason)}</span>}</li>)}</ul> : <p className="hint">还没有购买记录。</p>}</section>
  </main>;
}
