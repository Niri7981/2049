import { ExactSvmScheme } from "@x402/svm/exact/client";
import { getBase64EncodedWireTransaction, type TransactionSigner } from "@solana/kit";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { DEVNET_NETWORK, PAYMENT_AMOUNT, type PaymentConfig } from "./payment-config";

export const MARKET_RESOURCE = "/api/paid/market-snapshot?asset=SOL";

export function selectPaymentQuote(encoded: string, config: PaymentConfig, feePayer: string) {
  if (encoded.length > 16_384) throw new Error("Payment quote is too large");
  const quote = PaymentRequiredV2Schema.parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
  if (quote.resource.url !== MARKET_RESOURCE || quote.accepts.length !== 1) {
    throw new Error("Unexpected resource or payment options");
  }
  const requirement = quote.accepts[0];
  if (requirement.scheme !== "exact" || requirement.network !== config.network ||
      requirement.asset !== config.mint || requirement.payTo !== config.merchant ||
      requirement.amount !== PAYMENT_AMOUNT || requirement.extra?.feePayer !== feePayer ||
      typeof requirement.extra?.memo !== "string" || !/^day4:[A-Za-z0-9_-]{22}$/.test(requirement.extra.memo) ||
      requirement.extra.memo.length > 128 || requirement.maxTimeoutSeconds > 300 ||
      requirement.maxTimeoutSeconds <= 0) {
    throw new Error("Quote does not match the fixed payment");
  }
  return requirement as PaymentRequirements;
}

export async function solanaRpc<T>(config: Pick<PaymentConfig, "rpcUrl">, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(config.rpcUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed`);
  return body.result;
}

// The signer stays inside this script-only payment boundary. No Agent/UI import.
export async function prepareSolanaPayment(
  config: PaymentConfig, signer: TransactionSigner, requirement: PaymentRequirements,
  onSimulation: () => void = () => {},
): Promise<PaymentPayload> {
  if (requirement.scheme !== "exact" || requirement.network !== config.network || requirement.asset !== config.mint ||
      requirement.payTo !== config.merchant || requirement.amount !== PAYMENT_AMOUNT) {
    throw new Error("Signer rejected a payment outside the fixed payment configuration");
  }
  if (signer.address !== config.buyer || !("signTransactions" in signer)) {
    throw new Error("A partial signer matching the configured buyer is required");
  }
  const checkedSigner: TransactionSigner = {
    address: signer.address,
    async signTransactions(transactions, signingConfig) {
      for (const transaction of transactions) {
        const result = await solanaRpc<{ value: { err: unknown } }>(config, "simulateTransaction", [
          getBase64EncodedWireTransaction(transaction),
          { encoding: "base64", sigVerify: false, commitment: "confirmed" },
        ]);
        if (result?.value?.err !== null) throw new Error(`Payment simulation failed (${JSON.stringify(result?.value?.err ?? "missing result")}); nothing was signed or submitted`);
      }
      onSimulation();
      return signer.signTransactions(transactions, signingConfig);
    },
  };
  // Use our RPC for blockhashes instead of trusting a remote quote's optional hints.
  // SDK 2.25 dispatches RPC clients only for named Solana clusters. The explicit
  // loopback RPC remains authoritative for localnet; the wire quote keeps its real network.
  const safeRequirement = { ...requirement, network: config.cluster === "localnet" ? DEVNET_NETWORK : requirement.network,
    extra: { feePayer: requirement.extra?.feePayer, memo: requirement.extra?.memo } };
  const created = await new ExactSvmScheme(checkedSigner, { rpcUrl: config.rpcUrl })
    .createPaymentPayload(2, safeRequirement);
  return { ...created, accepted: requirement, resource: { url: MARKET_RESOURCE } };
}

export async function confirmSolanaTransaction(config: PaymentConfig, transaction: string) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const result = await solanaRpc<{ value: Array<null | { err: unknown; confirmationStatus: string }> }>(
      config, "getSignatureStatuses", [[transaction], { searchTransactionHistory: true }],
    );
    const status = result?.value?.[0];
    if (status && status.err !== null) throw new Error("Transaction failed on chain or returned an invalid status");
    if (status?.err === null && ["confirmed", "finalized"].includes(status.confirmationStatus)) return status.confirmationStatus;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Confirmation is UNKNOWN; reuse the saved payment, do not create another");
}
