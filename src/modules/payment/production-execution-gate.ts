import { assertPaymentConfigExecutionEnabled, type PaymentConfig } from './payment-config';
import { resourcePaymentBinding, validateResourceChallenge } from './resource-challenge';
import { X402ResourceSchema } from '../resources/http-resource';
import { hash } from '../authority/authority-policy';
import { monetaryScopeId } from '../purchases/monetary-scope';
import type { PurchaseLedger, PurchaseRecord } from '../purchases/purchase-ledger';
import { PAID_RESOURCE_PURCHASE_OPERATION } from '../authority/spend-grant';

/** Policy gate only. Wire format and transaction construction stay in the official SDK. */
export function assertProductionPaymentGate(ledger: PurchaseLedger, record: PurchaseRecord, config: PaymentConfig, endpoint: string) {
  assertPaymentConfigExecutionEnabled(config);
  if (config.mode !== 'live_mainnet') return;
  if (record.executionMode !== 'live_mainnet'
    || monetaryScopeId(record.monetaryScope) !== monetaryScopeId(ledger.paymentScope(config, 'live_mainnet'))) {
    throw new Error('MONETARY_SCOPE_MISMATCH');
  }
  const intent = record.intent;
  if (!intent.authority || intent.authority.operation !== PAID_RESOURCE_PURCHASE_OPERATION
    || intent.resourcePath || intent.offerId || intent.resourceScopeId || !intent.httpRequest || !intent.x402Challenge) {
    throw new Error('MAINNET_REGISTERED_RESOURCE_REQUIRED');
  }
  const resource = config.registeredResources?.find(candidate => candidate.resourceId === intent.resourceId);
  if (!resource) throw new Error('MAINNET_REGISTERED_RESOURCE_REQUIRED');
  const declared = X402ResourceSchema.parse(resource);
  if (declared.request.access !== 'https' || endpoint !== declared.request.url || declared.providerId !== intent.providerId
    || hash(declared.request) !== hash(intent.httpRequest) || hash(declared.deliveryRecovery ?? { kind: 'none' }) !== hash(intent.deliveryRecovery ?? { kind: 'none' })
    || declared.recipient === config.buyer || declared.recipient !== intent.payTo || intent.assetDecimals !== config.asset.decimals) {
    throw new Error('MAINNET_RESOURCE_BINDING_MISMATCH');
  }
  const { quote } = validateResourceChallenge(intent.x402Challenge, declared, config);
  if (hash(quote) !== hash(record.quote) || quote.amount !== intent.amount || quote.asset !== intent.assetId || quote.network !== intent.network
    || hash(quote) !== intent.quoteFingerprint || intent.paymentScheme !== quote.scheme
    || intent.executionBinding !== resourcePaymentBinding(config, config.buyer, declared.request, intent.x402Challenge, declared.deliveryRecovery)
    || quote.extra?.feePayer === config.buyer) throw new Error('MAINNET_PAYMENT_BINDING_MISMATCH');
}
