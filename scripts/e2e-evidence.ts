import { collectE2eEvidence } from '../src/modules/e2e/evidence';
import { loadPaymentConfig } from '../src/modules/payment/payment-config';

async function main() {
  const [requestId, ...extra] = process.argv.slice(2);
  if (!requestId || extra.length) throw new Error('Usage: npm run e2e:evidence -- <requestId>');
  const dataDirectory = process.env.APP2049_DATA_DIR;
  const settlementDatabase = process.env.DAY4_SETTLEMENT_DB;
  if (!dataDirectory || !settlementDatabase) throw new Error('APP2049_DATA_DIR and DAY4_SETTLEMENT_DB must explicitly select the isolated E2E databases');
  const config = loadPaymentConfig();
  const evidence = await collectE2eEvidence(requestId, { dataDirectory, settlementDatabase, config });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'E2E evidence collection failed';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
