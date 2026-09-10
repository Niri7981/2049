import { mkdirSync, writeFileSync } from "node:fs";
import { runDemoPreflight } from "../src/modules/demo/preflight";
runDemoPreflight()
  .then((result) => {
    mkdirSync(".data/day7", { recursive: true, mode: 0o700 });
    writeFileSync(
      ".data/day7/preflight.json",
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  })
  .catch(() => {
    console.error("Day 7 preflight failed; check local configuration.");
    process.exitCode = 1;
  });
