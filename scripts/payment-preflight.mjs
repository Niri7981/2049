import { loadPaymentConfig } from "../src/modules/payment/payment-config.ts";
import { runPaymentPreflight } from "../src/modules/payment/payment-preflight.ts";

try {
  const result = await runPaymentPreflight(loadPaymentConfig());
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    readyForSettlement: false,
    error: error instanceof Error ? error.message : "Payment preflight failed",
  }, null, 2));
  process.exitCode = 1;
}
