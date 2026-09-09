import { loadDay4Config } from "../src/modules/payment/day4-config.ts";
import { runDay4Preflight } from "../src/modules/payment/day4-preflight.ts";

try {
  const result = await runDay4Preflight(loadDay4Config());
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    readyForSettlement: false,
    error: error instanceof Error ? error.message : "Day 4 preflight failed",
  }, null, 2));
  process.exitCode = 1;
}
