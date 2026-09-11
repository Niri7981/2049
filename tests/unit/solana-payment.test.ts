import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { address, type TransactionSigner } from "@solana/kit";
import type { PaymentRequirements } from "@x402/core/types";
import { DEVNET_NETWORK, DEVNET_USDC_MINT, PAYMENT_AMOUNT, type PaymentConfig } from "../../src/modules/payment/payment-config";
import { confirmSolanaTransaction, solanaRpc, MARKET_RESOURCE, prepareSolanaPayment, selectPaymentQuote } from "../../src/modules/payment/solana-payment";

const sdk = vi.hoisted(() => ({ constructor: vi.fn(), createPaymentPayload: vi.fn() }));

vi.mock("@x402/svm/exact/client", () => ({
  ExactSvmScheme: class {
    constructor(...args: unknown[]) { sdk.constructor(...args); }
    createPaymentPayload(...args: unknown[]) { return sdk.createPaymentPayload(...args); }
  },
}));

vi.mock("@solana/kit", async importOriginal => ({
  ...await importOriginal<typeof import("@solana/kit")>(),
  getBase64EncodedWireTransaction: vi.fn(() => "unsigned-test-transaction"),
}));

const config: PaymentConfig = {
  cluster: "devnet",
  rpcUrl: "https://rpc.example.test",
  network: DEVNET_NETWORK,
  mint: DEVNET_USDC_MINT,
  buyer: "11111111111111111111111111111111",
  merchant: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  facilitatorUrl: "https://facilitator.example.test",
};
const feePayer = "ComputeBudget111111111111111111111111111111";

function requirement(): PaymentRequirements {
  return {
    scheme: "exact", network: config.network, asset: config.mint,
    amount: PAYMENT_AMOUNT, payTo: config.merchant, maxTimeoutSeconds: 120,
    extra: { feePayer, memo: "day4:ABCDEFGHIJKLMNOPQRSTUV" },
  };
}

function encodeQuote(payment = requirement(), resource = MARKET_RESOURCE, copies = 1) {
  return Buffer.from(JSON.stringify({
    x402Version: 2, resource: { url: resource }, accepts: Array.from({ length: copies }, () => payment),
  })).toString("base64");
}

function mockRpc(result: unknown) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Payment fixed payment quote", () => {
  it("accepts only the configured quote for the market resource", () => {
    expect(selectPaymentQuote(encodeQuote(), config, feePayer)).toEqual(requirement());
  });

  it.each([
    ["amount", "10001"], ["amount", "1000000"], ["payTo", config.buyer],
    ["network", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
    ["asset", config.buyer], ["scheme", "upto"],
    ["maxTimeoutSeconds", 301], ["maxTimeoutSeconds", 0],
  ])("rejects a changed %s (%s)", (field, value) => {
    const payment = { ...requirement(), [field]: value };
    expect(() => selectPaymentQuote(encodeQuote(payment), config, feePayer)).toThrow();
  });

  it.each([
    { feePayer: config.buyer, memo: "day4:ABCDEFGHIJKLMNOPQRSTUV" },
    { memo: "day4:ABCDEFGHIJKLMNOPQRSTUV" },
    { feePayer },
    { feePayer, memo: 42 },
    { feePayer, memo: "different-payment" },
    { feePayer, memo: `day4:${"x".repeat(124)}` },
  ])("rejects untrusted fee payer or memo %j", extra => {
    expect(() => selectPaymentQuote(encodeQuote({ ...requirement(), extra }), config, feePayer)).toThrow();
  });

  it("rejects a changed resource and ambiguous payment options", () => {
    expect(() => selectPaymentQuote(encodeQuote(requirement(), "/api/other"), config, feePayer)).toThrow();
    expect(() => selectPaymentQuote(encodeQuote(requirement(), MARKET_RESOURCE, 2), config, feePayer)).toThrow();
  });

  it("rejects malformed and oversized quote headers", () => {
    expect(() => selectPaymentQuote("not-json", config, feePayer)).toThrow();
    expect(() => selectPaymentQuote("a".repeat(16_385), config, feePayer)).toThrow("too large");
  });
});

describe("Payment simulation before signing", () => {
  function setupSigning() {
    const signTransactions = vi.fn().mockResolvedValue([{}]);
    const signer: TransactionSigner = { address: address(config.buyer), signTransactions };
    sdk.createPaymentPayload.mockImplementation(async () => {
      const checkedSigner = sdk.constructor.mock.lastCall![0];
      await checkedSigner.signTransactions([{ messageBytes: new Uint8Array(), signatures: {} }]);
      return { x402Version: 2, payload: { transaction: "signed-test-transaction" } };
    });
    return { signer, signTransactions };
  }

  it("does not call the underlying signer after simulation failure", async () => {
    const fetchMock = mockRpc({ value: { err: { InstructionError: [1, "InsufficientFunds"] } } });
    const { signer, signTransactions } = setupSigning();
    const onSimulation = vi.fn();

    await expect(prepareSolanaPayment(config, signer, requirement(), onSimulation)).rejects.toThrow("nothing was signed or submitted");

    expect(signTransactions).not.toHaveBeenCalled();
    expect(onSimulation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).method).toBe("simulateTransaction");
  });

  it("does not sign if simulation RPC fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "provider failure" } }))));
    const { signer, signTransactions } = setupSigning();
    await expect(prepareSolanaPayment(config, signer, requirement())).rejects.toThrow("RPC simulateTransaction failed");
    expect(signTransactions).not.toHaveBeenCalled();
  });

  it("does not sign when the simulation response omits its error status", async () => {
    mockRpc({ value: {} });
    const { signer, signTransactions } = setupSigning();
    await expect(prepareSolanaPayment(config, signer, requirement())).rejects.toThrow("nothing was signed or submitted");
    expect(signTransactions).not.toHaveBeenCalled();
  });

  it("signs after a successful simulation and discards quote RPC hints", async () => {
    mockRpc({ value: { err: null } });
    const { signer, signTransactions } = setupSigning();
    const onSimulation = vi.fn();
    const payment = requirement();
    payment.extra = { ...payment.extra, rpcUrl: "https://untrusted.example.test", feePayerRpcUrl: "https://untrusted.example.test" };
    const result = await prepareSolanaPayment(config, signer, payment, onSimulation);

    expect(onSimulation).toHaveBeenCalledOnce();
    expect(signTransactions).toHaveBeenCalledOnce();
    expect(onSimulation.mock.invocationCallOrder[0]).toBeLessThan(signTransactions.mock.invocationCallOrder[0]);
    expect(sdk.constructor.mock.lastCall![1]).toEqual({ rpcUrl: config.rpcUrl });
    expect(sdk.createPaymentPayload.mock.lastCall![1].extra).toEqual({ feePayer, memo: "day4:ABCDEFGHIJKLMNOPQRSTUV" });
    expect(result).toMatchObject({ accepted: payment, resource: { url: MARKET_RESOURCE }, payload: { transaction: "signed-test-transaction" } });
  });

  it("rejects a buyer address mismatch before invoking the SDK", async () => {
    const { signer, signTransactions } = setupSigning();
    await expect(prepareSolanaPayment({ ...config, buyer: config.merchant }, signer, requirement())).rejects.toThrow("matching the configured buyer");
    expect(sdk.constructor).not.toHaveBeenCalled();
    expect(signTransactions).not.toHaveBeenCalled();
  });

  it("rechecks the fixed amount inside the signing boundary", async () => {
    const { signer, signTransactions } = setupSigning();
    await expect(prepareSolanaPayment(config, signer, { ...requirement(), amount: "1000000" })).rejects.toThrow("outside the fixed");
    expect(sdk.constructor).not.toHaveBeenCalled();
    expect(signTransactions).not.toHaveBeenCalled();
  });
});

describe("Payment transaction confirmation", () => {
  it.each(["confirmed", "finalized"])("accepts %s only with no chain error", async confirmationStatus => {
    mockRpc({ value: [{ err: null, confirmationStatus }] });
    await expect(confirmSolanaTransaction(config, "test-signature")).resolves.toBe(confirmationStatus);
  });

  it("rejects a chain error even if the transaction is confirmed", async () => {
    mockRpc({ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] });
    await expect(confirmSolanaTransaction(config, "test-signature")).rejects.toThrow("failed on chain");
  });

  it("rejects confirmed responses that omit the transaction error field", async () => {
    mockRpc({ value: [{ confirmationStatus: "confirmed" }] });
    await expect(confirmSolanaTransaction(config, "test-signature")).rejects.toThrow("invalid status");
  });

  it.each([null, { err: null, confirmationStatus: "processed" }])("keeps %j unknown instead of reporting success", async status => {
    vi.useFakeTimers();
    const fetchMock = mockRpc({ value: [status] });
    const confirmation = confirmSolanaTransaction(config, "test-signature").catch(error => error);
    await vi.runAllTimersAsync();
    expect(await confirmation).toEqual(new Error("Confirmation is UNKNOWN; reuse the saved payment, do not create another"));
    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(fetchMock.mock.calls.every(([, options]) => JSON.parse(options.body).method === "getSignatureStatuses")).toBe(true);
  });

  it("surfaces transport and RPC failures without leaking provider error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(solanaRpc(config, "getSignatureStatuses")).rejects.toThrow("HTTP 503");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "secret-provider-diagnostic" } }))));
    await expect(confirmSolanaTransaction(config, "test-signature")).rejects.toThrow(/^RPC getSignatureStatuses failed$/);
  });
});
