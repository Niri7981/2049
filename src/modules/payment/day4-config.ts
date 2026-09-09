import { address } from "@solana/kit";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const PAYMENT_AMOUNT = "10000";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type Day4Config = {
  cluster: "devnet" | "localnet";
  rpcUrl: string;
  network: `solana:${string}`;
  mint: string;
  buyer: string;
  merchant: string;
  facilitatorUrl: string;
};

function publicKey(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  try {
    return address(value);
  } catch {
    throw new Error(`${name} must be a valid Solana public key`);
  }
}

function endpoint(value: string, name: string, localOnly: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (localOnly) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || !["http:", "https:"].includes(url.protocol)) {
      throw new Error(`${name} must use an exact loopback hostname`);
    }
  } else if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return url.toString().replace(/\/$/, "");
}

/** This configuration contains public addresses only; signing keys stay in the CLI. */
export function loadDay4Config(env: Record<string, string | undefined> = process.env): Day4Config {
  const cluster = env.SOLANA_CLUSTER || "devnet";
  if (cluster !== "devnet" && cluster !== "localnet") {
    throw new Error("SOLANA_CLUSTER must be devnet or localnet; mainnet is disabled");
  }
  const localnet = cluster === "localnet";
  const rpcUrl = endpoint(
    localnet ? env.SOLANA_LOCALNET_RPC_URL || "http://127.0.0.1:8899" : env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com",
    localnet ? "SOLANA_LOCALNET_RPC_URL" : "SOLANA_DEVNET_RPC_URL",
    localnet,
  );
  const buyer = publicKey(env.DEMO_BUYER_PUBLIC_KEY, "DEMO_BUYER_PUBLIC_KEY");
  const merchant = publicKey(env.DEMO_MERCHANT_PUBLIC_KEY, "DEMO_MERCHANT_PUBLIC_KEY");
  if (buyer === merchant) throw new Error("Buyer and merchant must be different wallets");
  const mint = publicKey(localnet ? env.LOCAL_USDC_MINT : DEVNET_USDC_MINT, "LOCAL_USDC_MINT");
  const network = localnet ? env.SOLANA_LOCALNET_NETWORK || "solana:localnet" : DEVNET_NETWORK;
  if (network !== "solana:localnet" && !/^solana:[1-9A-HJ-NP-Za-km-z]{32}$/.test(network)) {
    throw new Error("SOLANA_LOCALNET_NETWORK must contain the first 32 characters of the genesis hash");
  }
  if (localnet && [DEVNET_NETWORK, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"].includes(network)) {
    throw new Error("SOLANA_LOCALNET_NETWORK must identify a local test chain");
  }
  if (localnet && !env.X402_FACILITATOR_URL) throw new Error("X402_FACILITATOR_URL is required for localnet");
  const facilitatorUrl = endpoint(env.X402_FACILITATOR_URL || "https://x402.org/facilitator", "X402_FACILITATOR_URL", localnet);
  return { cluster, rpcUrl, network: network as Day4Config["network"], mint, buyer, merchant, facilitatorUrl };
}
