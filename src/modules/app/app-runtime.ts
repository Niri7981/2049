import { join } from 'node:path';
import { homedir } from 'node:os';
import { initializeProductWallet } from '../app-wallet/product-wallet';
import { DEVNET_USDC_MINT, loadPaymentConfig } from '../payment/payment-config';
import { PurchaseLedger } from '../purchases/purchase-ledger';
import { paymentEndpointForIntent, recoverApprovedPayment } from '../purchases/approved-payment';
import { purchaseMarketSnapshot } from '../purchases/purchase-market-snapshot';
import { hash } from '../purchases/spending-policy';
import { AgentConnection } from '../mcp/connection';
import { CodexIntegration, type CodexIntegrationOptions } from '../mcp/codex-integration';
import { type McpSessionEvent } from '../mcp/session';
import { ManagementApiError } from './management-auth';
import { PAID_RESOURCE_PURCHASE_OPERATION, SpendGrantInputSchema, type SpendPrincipal } from '../authority/spend-grant';
import { DEMO_MARKET_DATA_PROVIDER_ID } from '../resources/static-resource-registry';
import { PAID_RESOURCE_SCOPE_ID } from '../resources/paid-resources';
import { DEVNET_NETWORK } from '../payment/payment-config';
import { requestPaidResourcePurchase, type PurchaseRequestResult } from '../purchases/request-paid-resource-purchase';
import { readPaidResourceQuotes } from '../purchases/paid-resource-quote';
import { acquireDataDirectoryOwnership } from './data-directory-owner';
import { readWalletBalance } from './wallet-balance';
import { assembleAuthorityOverview } from './authority-overview';
import { resolveYoshConfiguration } from './yosh-configuration';
import { PaymentEnvironmentError, resolvePaymentEnvironment } from '../payment/payment-environment';

type RuntimeState = { runtime?: AppRuntime };
export type TestPurchaseResult = { purchaseId: string; status: string; deliveryStatus: string; policy: { decision: string; reason: string }; transaction: string | null; simulated: boolean; warning?: string };
const globals = globalThis as typeof globalThis & { __yosh?: RuntimeState };

function dataDirectory() {
  const configured = resolveYoshConfiguration().dataDirectory;
  // Reuse the installation's ledger, member identities and pending-payment evidence.
  return configured || join(homedir(), 'Library', 'Application Support', '2049');
}
function purchaseExecutionMode() {
  const environment = resolvePaymentEnvironment();
  if (environment.mode === 'live_mainnet') throw new PaymentEnvironmentError('MAINNET_EXECUTION_DISABLED', 'mainnet is disabled');
  if (environment.cluster !== 'devnet') throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', 'App requires Devnet test environment');
  return environment.mode;
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export class AppRuntime {
  readonly ledger: PurchaseLedger;
  readonly agentConnection: AgentConnection;
  private readonly memberConnections = new Map<string, AgentConnection>();
  private readonly codexIntegration: CodexIntegration;
  private providerWrite: Promise<unknown> = Promise.resolve();
  private readonly owner: ReturnType<typeof acquireDataDirectoryOwnership>;
  private accepting = true;
  private active = new Set<Promise<unknown>>();
  private startup?: Promise<void>;
  private recoveryStatus: 'idle' | 'running' | 'complete' | 'pending' = 'idle';
  private wallet?: Promise<{ address: string; reused: boolean }>;
  private walletAddress?: string;
  constructor(readonly directory = dataDirectory(), private dependencies: { initializeWallet?: () => Promise<{ address: string; reused: boolean }>; timeZone?: () => string; now?: () => number; fetcher?: typeof fetch; codex?: CodexIntegrationOptions } = {}) {
    resolveYoshConfiguration();
    purchaseExecutionMode();
    this.owner = acquireDataDirectoryOwnership(directory);
    let ledger: PurchaseLedger | undefined;
    try {
      ledger = new PurchaseLedger(join(directory, 'app-ledger.sqlite'), { managed: true, requireSpendGrant: true, timeZone: dependencies.timeZone ?? localTimeZone, now: dependencies.now });
      this.ledger = ledger;
      const defaultMemberId = this.ledger.defaultCardMember().id;
      for (const member of this.ledger.cardMembers()) {
        this.memberConnections.set(member.id, new AgentConnection(directory, member.id, id => this.ledger.isCardMemberActive(id), member.id !== defaultMemberId, dependencies.now));
      }
      this.agentConnection = this.memberConnections.get(defaultMemberId)!;
      this.codexIntegration = new CodexIntegration(directory, defaultMemberId, dependencies.codex);
      this.agentConnection.setIntegration(this.codexIntegration.configured, this.codexIntegration.serverName);
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
    for (const connection of this.memberConnections.values()) connection.setEnabled(false, '');
    this.ledger.close();
    this.owner.release();
  }
  async initializeWallet() {
    resolveYoshConfiguration();
    purchaseExecutionMode();
    this.wallet ??= (this.dependencies.initializeWallet ?? initializeProductWallet)().then(wallet => {
      this.walletAddress = wallet.address;
      process.env.DEMO_BUYER_PUBLIC_KEY = wallet.address;
      process.env.YOSH_USE_PRODUCT_WALLET = '1';
      if (process.env.APP2049_USE_PRODUCT_WALLET !== undefined) process.env.APP2049_USE_PRODUCT_WALLET = '1';
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
    resolveYoshConfiguration();
    purchaseExecutionMode();
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
        const config = loadPaymentConfig(process.env, 'simulated');
        if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Recovery wallet mismatch');
        for (const item of pending) {
          if (!this.accepting) break;
          try { const record = this.ledger.get(item.requestId, item.ownerCardMemberId);
            if (record) await recoverApprovedPayment(this.ledger, item.requestId, config,
              paymentEndpointForIntent(origin, record.intent), () => {}, item.ownerCardMemberId); }
          catch { /* Keep mismatched or unavailable original payments frozen. */ }
        }
      }
      this.recoveryStatus = this.ledger.pendingRecovery().length ? 'pending' : 'complete';
    } catch { this.recoveryStatus = 'pending'; }
    // Renaming an owned MCP entry must never delay or replace original payment recovery.
    if (this.accepting && this.codexIntegration.needsMigration) {
      try {
        await this.codexIntegration.migrateLegacy();
        this.agentConnection.setIntegration(this.accepting && this.codexIntegration.configured, this.codexIntegration.serverName);
      } catch {
        // Explicit Connect will surface the ownership conflict; configuration is not liveness.
        this.agentConnection.setIntegration(false, this.codexIntegration.serverName);
      }
    }
  }
  async prepareQuit() {
    this.accepting = false;
    this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now(), 'grant.REVOKED_SERVICE_EXIT');
    for (const connection of this.memberConnections.values()) connection.setEnabled(false, '');
    this.ledger.stopPayments();
    await Promise.allSettled([...this.active]);
  }
  async balance(address: string, fetcher: typeof fetch = fetch) {
    return readWalletBalance(address, fetcher);
  }
  async quotePaidResources(origin: string) {
    const wallet = await this.initializeWallet();
    const config = loadPaymentConfig(process.env, 'simulated');
    if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Devnet 钱包配置不匹配。');
    return readPaidResourceQuotes(origin, config, this.dependencies.fetcher);
  }
  async overview() {
    const wallet = await this.initializeWallet();
    return assembleAuthorityOverview(this.ledger, this.agentConnection, wallet,
      { status: this.accepting ? 'running' : 'stopping', recoveryStatus: this.recoveryStatus },
      this.dependencies.now?.() ?? Date.now(), purchaseExecutionMode(), this.ledger.defaultCardMember().id);
  }
  private connectionFor(memberId: string) {
    const connection = this.memberConnections.get(memberId);
    if (!connection || !this.ledger.cardMember(memberId)) throw new Error('CARD_MEMBER_NOT_FOUND');
    return connection;
  }
  authenticateAgent(request: Request, capability: 'read' | 'request_purchase' = 'read') {
    for (const connection of this.memberConnections.values()) {
      try { return connection.authenticate(request, capability); } catch { /* Try another member capability. */ }
    }
    throw new Error('AGENT_UNAUTHORIZED');
  }
  memberOverview(memberId: string) {
    const member = this.ledger.cardMember(memberId);
    if (!member) throw new Error('CARD_MEMBER_NOT_FOUND');
    const now = this.dependencies.now?.() ?? Date.now();
    return { member, connection: this.connectionFor(memberId).status(),
      grant: this.spendGrantSummary(memberId), purchases: this.ledger.list(50, memberId),
      budget: this.ledger.managedSummary(now, purchaseExecutionMode()) };
  }
  membersOverview() { return this.ledger.cardMembers().map(member => ({ member, connection: this.connectionFor(member.id).status(),
    grant: this.spendGrantSummary(member.id) })); }
  createCardMember(label: string) {
    const member = this.ledger.createCardMember(label);
    this.memberConnections.set(member.id, new AgentConnection(this.directory, member.id, id => this.ledger.isCardMemberActive(id), true));
    return this.memberOverview(member.id);
  }
  renameCardMember(memberId: string, label: string) {
    this.ledger.renameCardMember(memberId, label);
    return this.memberOverview(memberId);
  }
  revokeCardMember(memberId: string) {
    if (memberId === this.ledger.defaultCardMember().id) throw new Error('DEFAULT_CARD_MEMBER_REQUIRED');
    const connection = this.connectionFor(memberId);
    if (!this.ledger.revokeCardMember(memberId)) throw new Error('CARD_MEMBER_NOT_ACTIVE');
    connection.setEnabled(false, '');
    return this.memberOverview(memberId);
  }
  setDailyLimit(value: string | null) { return this.ledger.setDailyLimit(value); }
  spendGrantSummary(memberId = this.ledger.defaultCardMember().id) {
    return this.ledger.spendGrantSummary(this.dependencies.now?.() ?? Date.now(), purchaseExecutionMode(), memberId);
  }
  setPaused(value: boolean) { return this.ledger.setPaused(value); }
  setAgentConnection(enabled: boolean, origin: string, memberId = this.ledger.defaultCardMember().id) {
    if (!this.accepting) throw new Error('SERVICE_STOPPING');
    this.ledger.assertCardMemberActive(memberId);
    this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now(), 'grant.REVOKED_CONNECTION_CHANGED', memberId);
    const connection = this.connectionFor(memberId);
    connection.setEnabled(enabled, origin);
    return connection.status();
  }
  /** Default member is the existing Codex identity; labels never select providers. */
  setMemberConnection(enabled: boolean, origin: string, memberId: string) {
    if (memberId !== this.ledger.defaultCardMember().id) return Promise.resolve(this.setAgentConnection(enabled, origin, memberId));
    const operation = this.providerWrite.catch(() => {}).then(async () => {
      if (!this.accepting) throw new ManagementApiError('SERVICE_STOPPING', 503, 'Yosh 正在退出。');
      this.ledger.assertCardMemberActive(memberId);
      if (enabled) {
        await this.codexIntegration.connect();
        this.agentConnection.setIntegration(true, this.codexIntegration.serverName);
        // Quit may begin while Codex writes its configuration. Never re-enable after that boundary.
        if (!this.accepting) throw new ManagementApiError('SERVICE_STOPPING', 503, 'Yosh 正在退出。');
        if (!this.agentConnection.status().enabled) this.setAgentConnection(true, origin, memberId);
      } else {
        // Revoke first even if configuration removal subsequently fails or conflicts.
        this.setAgentConnection(false, origin, memberId);
        await this.codexIntegration.disconnect();
        this.agentConnection.setIntegration(false, this.codexIntegration.serverName);
      }
      return this.agentConnection.status();
    });
    this.providerWrite = operation;
    return this.track(operation);
  }
  observeMcpSession(request: Request, event: McpSessionEvent) {
    const principal = this.authenticateAgent(request);
    this.connectionFor(principal.cardMemberId).observeSession(event);
  }
  createSpendGrant(raw: unknown, memberId = this.ledger.defaultCardMember().id) {
    const input = SpendGrantInputSchema.parse(raw);
    const now = this.dependencies.now?.() ?? Date.now();
    const total = Number(input.totalLimit); const single = Number(input.singleLimit);
    if (total <= 0 || single <= 0 || single > total) throw new Error('授权金额必须为正数，且单笔上限不能大于授权总额。');
    if (input.expiresAt <= now + 60_000 || input.expiresAt > now + 7 * 24 * 60 * 60 * 1000) throw new Error('授权有效期必须在 1 分钟到 7 天之间。');
    const connection = this.connectionFor(memberId);
    const principal = connection.rotateCredential();
    if (!principal) throw new Error('请先启用 Agent 连接。');
    try {
      const payTo = process.env.DEMO_MERCHANT_PUBLIC_KEY || '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs';
      return this.ledger.createSpendGrant(input, principal, {
        resourceId: PAID_RESOURCE_SCOPE_ID,
        providerId: DEMO_MARKET_DATA_PROVIDER_ID,
        operation: PAID_RESOURCE_PURCHASE_OPERATION,
        network: DEVNET_NETWORK,
        assetId: DEVNET_USDC_MINT,
        assetDecimals: 6,
        payTo,
        paymentScheme: 'exact',
      }, now, purchaseExecutionMode());
    } catch (error) {
      this.ledger.revokeActiveSpendGrant(now, 'grant.REVOKED_CONNECTION_ROTATION_FAILED', memberId);
      connection.rotateCredential();
      throw error;
    }
  }
  revokeSpendGrant(memberId = this.ledger.defaultCardMember().id) {
    const revoked = this.ledger.revokeActiveSpendGrant(this.dependencies.now?.() ?? Date.now(), 'grant.REVOKED', memberId);
    this.connectionFor(memberId).rotateCredential();
    return revoked;
  }
  private authority(principal?: SpendPrincipal) {
    const current = principal ?? this.agentConnection.principal('request_purchase');
    if (!current) throw new Error('当前 Agent 连接没有消费权限。');
    return this.ledger.spendAuthority(current, PAID_RESOURCE_PURCHASE_OPERATION, this.dependencies.now?.() ?? Date.now());
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
    const config = loadPaymentConfig(process.env, 'simulated');
    if (config.cluster !== 'devnet' || config.buyer !== buyer) throw new Error('Devnet 钱包配置不匹配。');
    await this.start(origin);
    if (!this.accepting) throw new Error('服务正在退出，不能创建购买请求。');
    return requestPaidResourcePurchase(input, { config, ledger: this.ledger, origin, principal, execute: purchaseExecutionMode() === 'live_devnet', fetcher: this.dependencies.fetcher, now: this.dependencies.now });
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
      : loadPaymentConfig({ ...process.env, DEMO_BUYER_PUBLIC_KEY: wallet.address, DEMO_MERCHANT_PUBLIC_KEY: merchant }, 'simulated');
    if (config.cluster !== 'devnet' || config.buyer !== wallet.address) throw new Error('Devnet 钱包配置不匹配。');
    const authority = this.ledger.get(id) ? undefined : this.authority();
    // This legacy intent is a persisted request-hash input; branding must not break replay.
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
  resolveYoshConfiguration();
  globals.__yosh ??= {};
  globals.__yosh.runtime ??= new AppRuntime();
  return globals.__yosh.runtime;
}
