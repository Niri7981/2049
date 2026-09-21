import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initializeProductWallet } from '../app-wallet/product-wallet';
import { getStandardTokenAccount } from '../payment/payment-preflight';
import { DEVNET_USDC_MINT, TOKEN_PROGRAM, loadPaymentConfig } from '../payment/payment-config';
import { PurchaseLedger } from '../purchases/purchase-ledger';
import { paymentEndpoint, recoverApprovedPayment } from '../purchases/approved-payment';
import { purchaseMarketSnapshot } from '../purchases/purchase-market-snapshot';
import { hash } from '../purchases/spending-policy';
import { AgentConnection } from '../mcp/connection';

type RuntimeState = { runtime?: AppRuntime };
export type TestPurchaseResult = { purchaseId: string; status: string; deliveryStatus: string; policy: { decision: string; reason: string }; transaction: string | null; simulated: boolean; warning?: string };
const globals = globalThis as typeof globalThis & { __app2049?: RuntimeState };

function dataDirectory() {
  const configured = process.env.APP2049_DATA_DIR;
  const value = configured || join(homedir(), 'Library', 'Application Support', '2049');
  mkdirSync(value, { recursive: true, mode: 0o700 });
  return value;
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export class AppRuntime {
  readonly ledger: PurchaseLedger;
  readonly agentConnection: AgentConnection;
  private accepting = true;
  private active = new Set<Promise<unknown>>();
  private startup?: Promise<void>;
  private recoveryStatus: 'idle' | 'running' | 'complete' | 'pending' = 'idle';
  private wallet?: Promise<{ address: string; reused: boolean }>;
  constructor(readonly directory = dataDirectory(), private dependencies: { initializeWallet?: () => Promise<{ address: string; reused: boolean }>; timeZone?: () => string; now?: () => number } = {}) {
    this.agentConnection = new AgentConnection(directory);
    this.ledger = new PurchaseLedger(join(directory, 'app-ledger.sqlite'), { managed: true, timeZone: dependencies.timeZone ?? localTimeZone, now: dependencies.now });
  }
  async initializeWallet() {
    this.wallet ??= (this.dependencies.initializeWallet ?? initializeProductWallet)().then(wallet => {
      process.env.DEMO_BUYER_PUBLIC_KEY = wallet.address;
      process.env.APP2049_USE_PRODUCT_WALLET = '1';
      return wallet;
    }).catch(error => { this.wallet = undefined; throw error; });
    return this.wallet;
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.active.add(operation);
    void operation.then(() => this.active.delete(operation), () => this.active.delete(operation));
    return operation;
  }
  start(origin: string): Promise<void> {
    if (this.startup) return this.startup;
    if (!this.accepting) return Promise.resolve();
    this.startup = this.track(this.recoverOnStartup(origin));
    return this.startup;
  }
  private async recoverOnStartup(origin: string) {
    this.recoveryStatus = 'running';
    // The Electron single-instance owner starts this once before new purchases.
    this.ledger.recoverUnsubmittedOnStartup();
    try {
      const pending = this.ledger.pendingRecovery();
      if (pending.length) {
        const wallet = await this.initializeWallet();
        const config = loadPaymentConfig();
        if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Recovery wallet mismatch');
        const endpoint = paymentEndpoint(origin);
        for (const id of pending) {
          if (!this.accepting) break;
          try { await recoverApprovedPayment(this.ledger, id, config, endpoint); }
          catch { /* Keep mismatched or unavailable original payments frozen. */ }
        }
      }
      this.recoveryStatus = this.ledger.pendingRecovery().length ? 'pending' : 'complete';
    } catch { this.recoveryStatus = 'pending'; }
  }
  async prepareQuit() {
    this.accepting = false;
    this.agentConnection.setEnabled(false, '');
    this.ledger.stopPayments();
    await Promise.allSettled([...this.active]);
  }
  async balance(address: string, fetcher: typeof fetch = fetch) {
    try {
      const rpcUrl = new URL(process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com');
      if (rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password) throw new Error();
      const ata = await getStandardTokenAccount(address, DEVNET_USDC_MINT);
      const response = await fetcher(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [ata, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
        signal: AbortSignal.timeout(6_000), redirect: 'error' });
      const text = await response.text();
      if (text.length > 65_536) throw new Error();
      const body: unknown = JSON.parse(text);
      if (!response.ok || typeof body !== 'object' || body === null || !('result' in body)) throw new Error();
      const account = (body as { result?: { value?: unknown } }).result?.value;
      if (account === null) return { amount: '0', display: '0.00 test USDC', available: true as const };
      const parsed = account && typeof account === 'object' ? account as { owner?: unknown; data?: { parsed?: { info?: { owner?: unknown; mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } : undefined;
      const info = parsed?.data?.parsed?.info; const token = info?.tokenAmount; const amount = token?.amount;
      if (parsed?.owner !== TOKEN_PROGRAM || info?.owner !== address || info?.mint !== DEVNET_USDC_MINT || token?.decimals !== 6 || typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new Error();
      return { amount, display: `${(Number(amount) / 1_000_000).toFixed(2)} test USDC`, available: true as const };
    } catch {
      return { amount: null, display: '暂时无法读取', available: false as const };
    }
  }
  async overview(fetcher: typeof fetch = fetch) {
    const wallet = await this.initializeWallet();
    const balance = await this.balance(wallet.address, fetcher);
    const budget = this.ledger.managedSummary();
    const display = (value: string | null) => value === null ? '未设置' : `${(Number(value) / 1_000_000).toFixed(2)} test USDC`;
    return { service: { status: this.accepting ? 'running' : 'stopping', recoveryStatus: this.recoveryStatus, network: 'Solana Devnet', testEnvironment: true,
        purchaseMode: process.env.APP2049_ENABLE_DEVNET_PURCHASES === '1' ? 'live_devnet' : 'simulated' },
      wallet: { address: wallet.address, reused: wallet.reused, balance }, budget: { ...budget, dailyLimitDisplay: display(budget.dailyLimit),
        paidDisplay: display(budget.paid), reservedDisplay: display(budget.reserved), remainingDisplay: display(budget.remaining) }, purchases: this.ledger.list(), connection: this.agentConnection.status() };
  }
  setDailyLimit(value: string | null) { return this.ledger.setDailyLimit(value); }
  setPaused(value: boolean) { return this.ledger.setPaused(value); }
  createTestPurchase(id: string, origin: string): Promise<TestPurchaseResult> {
    if (!this.accepting) return Promise.reject(new Error('服务正在退出，不能开始新付款。'));
    return this.track(this.performTestPurchase(id, origin));
  }
  private async performTestPurchase(id: string, origin: string): Promise<TestPurchaseResult> {
    if (!this.accepting) throw new Error('服务正在退出，不能开始新付款。');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('无效的购买编号。');
    await this.start(origin);
    const wallet = await this.initializeWallet();
    if (!this.accepting) throw new Error('服务正在退出，不能开始新付款。');
    const merchant = process.env.DEMO_MERCHANT_PUBLIC_KEY || '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs';
    const mode = process.env.APP2049_ENABLE_DEVNET_PURCHASES === '1' ? 'live_devnet' : 'simulated';
    const config = mode === 'live_devnet'
      ? loadPaymentConfig()
      : loadPaymentConfig({ ...process.env, SOLANA_CLUSTER: 'devnet', DEMO_BUYER_PUBLIC_KEY: wallet.address, DEMO_MERCHANT_PUBLIC_KEY: merchant });
    if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Devnet 钱包配置不匹配。');
    const result = await purchaseMarketSnapshot({ purchaseId: id, intent: '2049 App test purchase' }, {
      config, ledger: this.ledger, origin, mode,
      legacyBindings: mode === 'simulated' ? [hash(['simulated-devnet', wallet.address, merchant])] : undefined,
    });
    const saved = result.record;
    return { purchaseId: id, status: saved.status, deliveryStatus: saved.deliveryStatus, policy: saved.decision, transaction: saved.transaction ?? null,
      simulated: result.simulated, ...(result.simulated ? { warning: '本次只验证本地策略、状态和账本，没有签名或链上付款。' } : {}) };
  }
}

export function appRuntime() {
  globals.__app2049 ??= {};
  globals.__app2049.runtime ??= new AppRuntime();
  return globals.__app2049.runtime;
}
