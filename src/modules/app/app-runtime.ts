import { join } from 'node:path';
import { homedir } from 'node:os';
import { initializeProductWallet } from '../app-wallet/product-wallet';
import { DEVNET_USDC_MINT, loadPaymentConfig } from '../payment/payment-config';
import { PurchaseLedger } from '../purchases/purchase-ledger';
import { paymentEndpoint, recoverApprovedPayment } from '../purchases/approved-payment';
import { purchaseMarketSnapshot } from '../purchases/purchase-market-snapshot';
import { hash } from '../purchases/spending-policy';
import { AgentConnection } from '../mcp/connection';
import { MARKET_SNAPSHOT_OPERATION, SpendGrantInputSchema, type SpendPrincipal } from '../authority/spend-grant';
import { DEMO_MARKET_DATA_PROVIDER_ID, PREMIUM_SOL_MARKET_SNAPSHOT_ID } from '../resources/static-resource-registry';
import { DEVNET_NETWORK } from '../payment/payment-config';
import { requestMarketPurchase, type PurchaseRequestResult } from '../purchases/request-market-purchase';
import { acquireDataDirectoryOwnership } from './data-directory-owner';
import { readWalletBalance } from './wallet-balance';
import { assembleAuthorityOverview } from './authority-overview';

type RuntimeState = { runtime?: AppRuntime };
export type TestPurchaseResult = { purchaseId: string; status: string; deliveryStatus: string; policy: { decision: string; reason: string }; transaction: string | null; simulated: boolean; warning?: string };
const globals = globalThis as typeof globalThis & { __app2049?: RuntimeState };

function dataDirectory() {
  const configured = process.env.APP2049_DATA_DIR;
  return configured || join(homedir(), 'Library', 'Application Support', '2049');
}
function purchaseExecutionMode() {
  return process.env.APP2049_ENABLE_DEVNET_PURCHASES === '1' ? 'live_devnet' as const : 'simulated' as const;
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export class AppRuntime {
  readonly ledger: PurchaseLedger;
  readonly agentConnection: AgentConnection;
  private readonly owner: ReturnType<typeof acquireDataDirectoryOwnership>;
  private accepting = true;
  private active = new Set<Promise<unknown>>();
  private startup?: Promise<void>;
  private recoveryStatus: 'idle' | 'running' | 'complete' | 'pending' = 'idle';
  private wallet?: Promise<{ address: string; reused: boolean }>;
  private walletAddress?: string;
  constructor(readonly directory = dataDirectory(), private dependencies: { initializeWallet?: () => Promise<{ address: string; reused: boolean }>; timeZone?: () => string; now?: () => number; fetcher?: typeof fetch } = {}) {
    this.owner = acquireDataDirectoryOwnership(directory);
    let ledger: PurchaseLedger | undefined;
    try {
      ledger = new PurchaseLedger(join(directory, 'app-ledger.sqlite'), { managed: true, requireSpendGrant: true, timeZone: dependencies.timeZone ?? localTimeZone, now: dependencies.now });
      this.ledger = ledger;
      const cardMember = this.ledger.defaultCardMember();
      this.agentConnection = new AgentConnection(directory, cardMember.id, id => this.ledger.isCardMemberActive(id));
      // Connection tokens intentionally do not survive a backend restart. The
      // stable CardMember keeps ownership, but the previous spend delegation is revoked.
      this.ledger.revokeActiveSpendGrant(dependencies.now?.() ?? Date.now(), 'grant.REVOKED_BACKEND_RESTART');
    } catch (error) {
      ledger?.close();
      this.owner.release();
      throw error;
    }
  }
  close() {
    if (this.active.size) throw new Error('Cannot close the backend while operations are active');
    this.accepting = false;
    this.ledger.close();
    this.owner.release();
  }
  async initializeWallet() {
    this.wallet ??= (this.dependencies.initializeWallet ?? initializeProductWallet)().then(wallet => {
      this.walletAddress = wallet.address;
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
        for (const id of pending) {
          if (!this.accepting) break;
          try { await recoverApprovedPayment(this.ledger, id, config, paymentEndpoint(origin, this.ledger.get(id)?.intent.offerId)); }
          catch { /* Keep mismatched or unavailable original payments frozen. */ }
        }
      }
      this.recoveryStatus = this.ledger.pendingRecovery().length ? 'pending' : 'complete';
    } catch { this.recoveryStatus = 'pending'; }
  }
  async prepareQuit() {
    this.accepting = false;
    this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now(), 'grant.REVOKED_SERVICE_EXIT');
    this.agentConnection.setEnabled(false, '');
    this.ledger.stopPayments();
    await Promise.allSettled([...this.active]);
  }
  async balance(address: string, fetcher: typeof fetch = fetch) {
    return readWalletBalance(address, fetcher);
  }
  async overview() {
    const wallet = await this.initializeWallet();
    return assembleAuthorityOverview(this.ledger, this.agentConnection, wallet,
      { status: this.accepting ? 'running' : 'stopping', recoveryStatus: this.recoveryStatus },
      this.dependencies.now?.() ?? Date.now(), purchaseExecutionMode());
  }
  setDailyLimit(value: string | null) { return this.ledger.setDailyLimit(value); }
  spendGrantSummary() {
    return this.ledger.spendGrantSummary(this.dependencies.now?.() ?? Date.now(), purchaseExecutionMode());
  }
  setPaused(value: boolean) { return this.ledger.setPaused(value); }
  setAgentConnection(enabled: boolean, origin: string) {
    this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now(), 'grant.REVOKED_CONNECTION_CHANGED');
    this.agentConnection.setEnabled(enabled, origin);
    return this.agentConnection.status();
  }
  createSpendGrant(raw: unknown) {
    const input = SpendGrantInputSchema.parse(raw);
    const now = this.dependencies.now?.() ?? Date.now();
    const total = Number(input.totalLimit); const single = Number(input.singleLimit);
    if (total <= 0 || single <= 0 || single > total) throw new Error('授权金额必须为正数，且单笔上限不能大于授权总额。');
    if (input.expiresAt <= now + 60_000 || input.expiresAt > now + 7 * 24 * 60 * 60 * 1000) throw new Error('授权有效期必须在 1 分钟到 7 天之间。');
    const principal = this.agentConnection.rotateCredential();
    if (!principal) throw new Error('请先启用 Agent 连接。');
    try {
      const payTo = process.env.DEMO_MERCHANT_PUBLIC_KEY || '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs';
      return this.ledger.createSpendGrant(input, principal, {
        resourceId: PREMIUM_SOL_MARKET_SNAPSHOT_ID,
        providerId: DEMO_MARKET_DATA_PROVIDER_ID,
        operation: MARKET_SNAPSHOT_OPERATION,
        network: DEVNET_NETWORK,
        assetId: DEVNET_USDC_MINT,
        assetDecimals: 6,
        payTo,
        paymentScheme: 'exact',
      }, now, purchaseExecutionMode());
    } catch (error) {
      this.ledger.revokeActiveSpendGrant(now, 'grant.REVOKED_CONNECTION_ROTATION_FAILED');
      this.agentConnection.rotateCredential();
      throw error;
    }
  }
  revokeSpendGrant() {
    const revoked = this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now());
    this.agentConnection.rotateCredential();
    return revoked;
  }
  private authority(principal?: SpendPrincipal) {
    const current = principal ?? this.agentConnection.principal('request_purchase');
    if (!current) throw new Error('当前 Agent 连接没有消费权限。');
    return this.ledger.spendAuthority(current, MARKET_SNAPSHOT_OPERATION, this.dependencies.now?.() ?? Date.now());
  }
  requestPurchase(input: unknown, origin: string, principal: SpendPrincipal): Promise<PurchaseRequestResult> {
    if (!this.accepting) return Promise.reject(new Error('服务正在退出，不能创建购买请求。'));
    return this.track(this.performPurchaseRequest(input, origin, principal));
  }
  private async performPurchaseRequest(input: unknown, origin: string, principal: SpendPrincipal) {
    if (!this.accepting) throw new Error('服务正在退出，不能创建购买请求。');
    // A SpendGrant can only be created from the initialized App session. Keep
    // denied path away from Keychain and all signer construction.
    const buyer = this.walletAddress;
    if (!buyer) throw new Error('产品钱包尚未初始化。');
    const config = loadPaymentConfig();
    if (config.cluster !== 'devnet' || config.buyer !== buyer) throw new Error('Devnet 钱包配置不匹配。');
    await this.start(origin);
    if (!this.accepting) throw new Error('服务正在退出，不能创建购买请求。');
    return requestMarketPurchase(input, { config, ledger: this.ledger, origin, principal, execute: purchaseExecutionMode() === 'live_devnet', fetcher: this.dependencies.fetcher, now: this.dependencies.now });
  }
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
    const mode = purchaseExecutionMode();
    const config = mode === 'live_devnet'
      ? loadPaymentConfig()
      : loadPaymentConfig({ ...process.env, SOLANA_CLUSTER: 'devnet', DEMO_BUYER_PUBLIC_KEY: wallet.address, DEMO_MERCHANT_PUBLIC_KEY: merchant });
    if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Devnet 钱包配置不匹配。');
    const authority = this.ledger.get(id) ? undefined : this.authority();
    const result = await purchaseMarketSnapshot({ purchaseId: id, intent: '2049 App test purchase' }, {
      config, ledger: this.ledger, origin, mode,
      authority,
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
