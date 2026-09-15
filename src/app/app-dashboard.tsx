'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Overview = {
  service: { status: string; network: string; testEnvironment: boolean; purchaseMode: 'simulated' | 'live_devnet' };
  wallet: { address: string; reused: boolean; balance: { amount: string | null; display: string; available: boolean } };
  budget: { day: string; timeZone: string; dailyLimit: string | null; paidDisplay: string; reservedDisplay: string; remainingDisplay: string; dailyLimitDisplay: string; paused: boolean; unresolved: number };
  purchases: Array<{ purchaseId: string; status: string; amount: string; createdAt: number; transaction: string | null }>;
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

export function AppDashboard() {
  const [data, setData] = useState<Overview>();
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purchaseId, setPurchaseId] = useState(() => `app-${crypto.randomUUID()}`);
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
  return <main className="app-shell">
    <header><div><p className="eyebrow">2049 · 本地购买服务</p><h1>消费钱包</h1></div><span className={data?.budget.paused ? 'pill warn' : 'pill'}>{data?.budget.paused ? '付款已暂停' : '服务运行中'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    <section><h2>钱包</h2><p className="address">{data?.wallet.address || '正在初始化…'}</p><div className="metric"><span>Devnet 余额</span><strong>{data?.wallet.balance.display || '—'}</strong></div><p className="hint">从 Phantom 等外部钱包向上方地址转入测试 USDC。私钥仅保存在 macOS 钥匙串。</p></section>
    <section><h2>每日共用额度</h2><div className="limit-row"><label><span>额度（test USDC）</span><input value={limit} onChange={event => setLimit(event.target.value)} placeholder="例如 1.00" inputMode="decimal" /></label><button disabled={busy} onClick={() => void saveLimit()}>保存额度</button></div>
      <div className="metrics"><div><span>今日已消费</span><strong>{data?.budget.paidDisplay || '—'}</strong></div><div><span>预占</span><strong>{data?.budget.reservedDisplay || '—'}</strong></div><div><span>剩余</span><strong>{data?.budget.remainingDisplay || '—'}</strong></div></div><p className="hint">{data ? `${data.budget.day} · ${data.budget.timeZone}` : '读取中…'}。修改额度不会清空今天的消费。</p>
      <button className="secondary" disabled={busy} onClick={() => void mutate('/api/app/settings', { paused: !data?.budget.paused })}>{data?.budget.paused ? '继续付款' : '暂停付款'}</button></section>
    <section><h2>测试购买</h2><p className="hint">仅限 Solana Devnet。默认模拟模式不会签名或提交交易；真实测试需要显式启用。</p><button disabled={busy || !data?.budget.dailyLimit || data?.budget.paused} onClick={() => void buy()}>{purchaseLabel}</button></section>
    <section><h2>购买记录</h2>{data?.purchases.length ? <ul className="records">{data.purchases.map(item => <li key={item.purchaseId}><div><strong>{item.status}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div><code>{item.purchaseId}</code><span>{(Number(item.amount) / 1_000_000).toFixed(2)} test USDC</span></li>)}</ul> : <p className="hint">还没有购买记录。</p>}</section>
  </main>;
}
