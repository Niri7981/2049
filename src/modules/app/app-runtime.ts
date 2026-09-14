import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { PaymentRequirements } from '@x402/core/types';
import { initializeProductWallet } from '../app-wallet/product-wallet';
import { getStandardTokenAccount } from '../payment/payment-preflight';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, TOKEN_PROGRAM, loadPaymentConfig } from '../payment/payment-config';
import { demoSnapshot } from '../paid-market-api/paid-market-api';
import { PurchaseLedger } from '../purchases/purchase-ledger';
import { hash, PurchaseSchema } from '../purchases/spending-policy';
import { createStaticResourceRegistry } from '../resources/static-resource-registry';
import { runTask } from '../agent/task-runtime';
import { localCapabilityPlanner } from '../agent/local-capability-planner';

type RuntimeState = { runtime?: AppRuntime };
export type TestPurchaseResult = { purchaseId: string; status: string; policy: { decision: string; reason: string }; transaction: string | null; simulated: boolean; warning?: string };
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
  private accepting = true;
  private wallet?: Promise<{ address: string; reused: boolean }>;
  constructor(readonly directory = dataDirectory(), private dependencies: { initializeWallet?: () => Promise<{ address: string; reused: boolean }>; timeZone?: () => string; now?: () => number } = {}) {
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
  prepareQuit() { this.accepting = false; }
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
    return { service: { status: this.accepting ? 'running' : 'stopping', network: 'Solana Devnet', testEnvironment: true,
        purchaseMode: process.env.APP2049_ENABLE_DEVNET_PURCHASES === '1' ? 'live_devnet' : 'simulated' },
      wallet: { address: wallet.address, reused: wallet.reused, balance }, budget: { ...budget, dailyLimitDisplay: display(budget.dailyLimit),
        paidDisplay: display(budget.paid), reservedDisplay: display(budget.reserved), remainingDisplay: display(budget.remaining) }, purchases: this.ledger.list() };
  }
  setDailyLimit(value: string | null) { return this.ledger.setDailyLimit(value); }
  setPaused(value: boolean) { return this.ledger.setPaused(value); }
  async createTestPurchase(id: string, origin: string): Promise<TestPurchaseResult> {
    if (!this.accepting) throw new Error('服务正在退出，不能开始新付款。');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('无效的购买编号。');
    const wallet = await this.initializeWallet();
    if (process.env.APP2049_ENABLE_DEVNET_PURCHASES === '1') {
      const config = loadPaymentConfig();
      if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Devnet 钱包配置不匹配。');
      const result = await runTask({ taskId: id, task: '分析 SOL 市场价格和 RSI' }, { planner: localCapabilityPlanner, plannerMode: 'local_demo', config, ledger: this.ledger, origin });
      if (!('policy' in result)) throw new Error('测试购买没有生成有效报价。');
      return { purchaseId: id, status: result.status, policy: result.policy, transaction: result.transaction ?? null, simulated: false };
    }

    const merchant = process.env.DEMO_MERCHANT_PUBLIC_KEY || '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs';
    const resource = createStaticResourceRegistry({ endpoint: 'https://purchase.local.invalid/api/paid/market-snapshot', asset_id: DEVNET_USDC_MINT, network: DEVNET_NETWORK, allowed_pay_to: merchant })[0];
    const now = Date.now();
    const quote: PaymentRequirements = { scheme: 'exact', network: DEVNET_NETWORK, asset: DEVNET_USDC_MINT, amount: '10000', payTo: merchant, maxTimeoutSeconds: 300, extra: { feePayer: wallet.address, memo: `app-test:${id}` } };
    const binding = hash(['simulated-devnet', wallet.address, merchant]);
    const purchase = PurchaseSchema.parse({ id: randomUUID(), taskId: id, taskHash: hash('2049 Devnet test purchase'), resourceId: resource.resource_id,
      providerId: resource.provider_id, input: { asset: 'SOL' }, amount: 10000, currency: 'USDC', decimals: 6, mint: DEVNET_USDC_MINT,
      network: DEVNET_NETWORK, payTo: merchant, scheme: 'exact', quoteFingerprint: hash(quote), createdAt: now, expiresAt: now + 300_000, binding });
    const record = this.ledger.reserve(purchase, quote, resource, now);
    if (record.purchase.id === purchase.id && record.status === 'APPROVED') {
      this.ledger.claim(record.approvalId, now);
      this.ledger.finish(record.approvalId, { transaction: `simulated-${id}`, data: demoSnapshot }, now);
    }
    const saved = this.ledger.get(id)!;
    return { purchaseId: id, status: saved.status, policy: saved.decision, transaction: saved.transaction ?? null,
      simulated: true, warning: '本次只验证本地策略、状态和账本，没有签名或链上付款。' };
  }
}

export function appRuntime() {
  globals.__app2049 ??= {};
  globals.__app2049.runtime ??= new AppRuntime();
  return globals.__app2049.runtime;
}
