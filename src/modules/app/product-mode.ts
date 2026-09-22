/** The legacy task worker can spend through the historical demo ledger. */
export function legacyDemoPurchasesAllowed(env: Record<string, string | undefined> = process.env) {
  return !env.APP2049_MANAGEMENT_TOKEN;
}
