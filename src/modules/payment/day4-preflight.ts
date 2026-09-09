import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { DEVNET_GENESIS, PAYMENT_AMOUNT, TOKEN_PROGRAM, type Day4Config } from "./day4-config";

const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const REQUEST_TIMEOUT_MS = 10_000;
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

export async function getStandardTokenAccount(owner: string, mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [encoder.encode(address(owner)), encoder.encode(address(TOKEN_PROGRAM)), encoder.encode(address(mint))],
  });
  return ata;
}

export type Day4PreflightSummary = {
  cluster: Day4Config["cluster"];
  network: Day4Config["network"];
  mint: string;
  paymentAmount: string;
  buyer: { publicKey: string; ata: string; balanceBaseUnits: string };
  merchant: { publicKey: string; ata: string; balanceBaseUnits: string };
  facilitator: { feePayer: string; feePayerLamports: number };
  readyForSettlement: true;
};

/** Fail closed; never include RPC URLs, provider payloads, or credentials in errors. */
export async function runDay4Preflight(
  config: Day4Config,
  dependencies: { fetch?: typeof fetch } = {},
): Promise<Day4PreflightSummary> {
  const fetcher = dependencies.fetch || fetch;
  async function json(url: string, label: string, init: RequestInit = {}): Promise<JsonObject> {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error" });
      if (!response.ok) throw new Error();
      return object(await response.json());
    } catch {
      throw new Error(`${label} request failed or timed out`);
    }
  }
  async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await json(config.rpcUrl, `RPC ${method}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.error || !("result" in response)) throw new Error(`RPC ${method} returned an error`);
    return response.result;
  }

  const genesis = await rpc("getGenesisHash");
  if (typeof genesis !== "string" || (config.cluster === "devnet" && genesis !== DEVNET_GENESIS)) {
    throw new Error("RPC genesis hash does not match Solana Devnet");
  }
  if (config.cluster === "localnet" && (genesis === DEVNET_GENESIS
    || genesis.startsWith("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
    || (config.network !== "solana:localnet" && config.network !== `solana:${genesis.slice(0, 32)}`))) {
    throw new Error("RPC genesis hash does not match the configured local test chain");
  }
  const supportedUrl = new URL(config.facilitatorUrl);
  supportedUrl.pathname = `${supportedUrl.pathname.replace(/\/$/, "")}/supported`;
  const supported = await json(supportedUrl.toString(), "Facilitator supported");
  const kind = (Array.isArray(supported.kinds) ? supported.kinds : []).map(object).find(
    (item) => item.x402Version === 2 && item.scheme === "exact" && item.network === config.network,
  );
  if (!kind) throw new Error("Facilitator does not support x402 v2 exact payments on the configured network");
  const rawFeePayer = object(kind.extra).feePayer;
  let feePayer: string;
  try {
    if (typeof rawFeePayer !== "string") throw new Error();
    feePayer = address(rawFeePayer);
  } catch {
    throw new Error("Facilitator supported response must provide a valid feePayer");
  }
  const [buyerAta, merchantAta] = await Promise.all([
    getStandardTokenAccount(config.buyer, config.mint), getStandardTokenAccount(config.merchant, config.mint),
  ]);
  const [accounts, feeBalance] = await Promise.all([
    rpc("getMultipleAccounts", [[config.mint, buyerAta, merchantAta], { encoding: "jsonParsed", commitment: "confirmed" }]),
    rpc("getBalance", [feePayer, { commitment: "confirmed" }]),
  ]);
  const values = object(accounts).value;
  if (!Array.isArray(values) || values.length !== 3) throw new Error("RPC returned invalid token accounts");
  const [mintAccount, buyerAccount, merchantAccount] = values.map(object);
  const parsedMint = object(object(mintAccount.data).parsed);
  const mintInfo = object(parsedMint.info);
  if (mintAccount.owner !== TOKEN_PROGRAM || parsedMint.type !== "mint" || mintInfo.decimals !== 6 || mintInfo.isInitialized !== true) {
    throw new Error("Payment mint must be an initialized classic SPL token with 6 decimals");
  }
  function tokenBalance(account: JsonObject, owner: string, label: string): string {
    const parsed = object(object(account.data).parsed);
    const info = object(parsed.info);
    const amount = object(info.tokenAmount);
    if (account.owner !== TOKEN_PROGRAM || parsed.type !== "account" || info.owner !== owner || info.mint !== config.mint
      || info.state !== "initialized" || amount.decimals !== 6 || typeof amount.amount !== "string" || !/^\d+$/.test(amount.amount)) {
      throw new Error(`${label} standard associated token account is missing, frozen, or invalid`);
    }
    return amount.amount;
  }
  const buyerBalance = tokenBalance(buyerAccount, config.buyer, "Buyer");
  const merchantBalance = tokenBalance(merchantAccount, config.merchant, "Merchant");
  if (BigInt(buyerBalance) < BigInt(PAYMENT_AMOUNT)) throw new Error("Buyer associated token account has less than 0.01 USDC");
  const feePayerLamports = object(feeBalance).value;
  // Two signatures at 5,000 lamports plus the SDK's minimal priority fee.
  if (typeof feePayerLamports !== "number" || !Number.isSafeInteger(feePayerLamports) || feePayerLamports < 10_001) {
    throw new Error("Facilitator fee payer must have SOL for transaction fees");
  }
  return {
    cluster: config.cluster, network: config.network, mint: config.mint, paymentAmount: PAYMENT_AMOUNT,
    buyer: { publicKey: config.buyer, ata: buyerAta, balanceBaseUnits: buyerBalance },
    merchant: { publicKey: config.merchant, ata: merchantAta, balanceBaseUnits: merchantBalance },
    facilitator: { feePayer, feePayerLamports }, readyForSettlement: true,
  };
}
