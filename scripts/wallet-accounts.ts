import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { address, blockhash, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
  compileTransaction, getBase64EncodedWireTransaction, signTransactionMessageWithSigners,
  getSignatureFromTransaction } from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import { loadPaymentConfig, DEVNET_GENESIS, TOKEN_PROGRAM } from '../src/modules/payment/payment-config';
import { getStandardTokenAccount } from '../src/modules/payment/payment-preflight';
import { solanaRpc, confirmSolanaTransaction } from '../src/modules/payment/solana-payment';
import { loadBuyerSigner } from '../src/modules/payment/wallet';

type Account = { owner: string; data: { parsed: { type: string; info: { decimals?: number; isInitialized?: boolean; owner?: string; mint?: string; state?: string } } } };
export async function setupWalletAccounts(directory = '.data') {
  const config = loadPaymentConfig();
  if (config.cluster !== 'devnet' || await solanaRpc(config, 'getGenesisHash') !== DEVNET_GENESIS) throw new Error('Account setup requires verified Devnet');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(join(directory, 'day4-accounts-lock.sqlite'));
  try {
    lock.exec('PRAGMA busy_timeout=1000; BEGIN EXCLUSIVE');
    const binding = { buyer: config.buyer, merchant: config.merchant, mint: config.mint };
    let saved: { binding: typeof binding; transaction: string } | undefined;
    try { saved = JSON.parse(await readFile(join(directory, 'day4-accounts.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (saved) {
      if (JSON.stringify(saved.binding) !== JSON.stringify(binding)) throw new Error('Account setup journal belongs to another configuration');
      await confirmSolanaTransaction(config, saved.transaction);
      console.log(JSON.stringify({ accountsReady: true, reused: true, transaction: saved.transaction }));
      return;
    }
    const owners = [config.buyer, config.merchant];
    const atas = await Promise.all(owners.map(owner => getStandardTokenAccount(owner, config.mint)));
    const result = await solanaRpc<{ value: Array<Account | null> }>(config, 'getMultipleAccounts', [[config.mint, ...atas], { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    if (!Array.isArray(result?.value) || result.value.length !== 3) throw new Error('Invalid account response');
    const [mint, ...accounts] = result.value;
    if (mint?.owner !== TOKEN_PROGRAM || mint.data?.parsed?.type !== 'mint' || mint.data.parsed.info.decimals !== 6 || mint.data.parsed.info.isInitialized !== true) throw new Error('Invalid test USDC mint');
    const missing = accounts.flatMap((account, index) => {
      if (account === null) return [index];
      const info = account.data?.parsed?.info;
      if (account.owner !== TOKEN_PROGRAM || account.data?.parsed?.type !== 'account' || info?.owner !== owners[index] || info.mint !== config.mint || info.state !== 'initialized') throw new Error('Invalid existing USDC account');
      return [];
    });
    if (!missing.length) { console.log(JSON.stringify({ accountsReady: true, created: 0, atas })); return; }
    const balance = await solanaRpc<{ value: number }>(config, 'getBalance', [config.buyer, { commitment: 'confirmed' }]);
    const rent = await solanaRpc<number>(config, 'getMinimumBalanceForRentExemption', [165]);
    // Fixed instructions, at most two classic ATAs; reserve 10,000 lamports for fees.
    const budget = rent * missing.length + 10_000;
    if (!Number.isSafeInteger(rent) || rent <= 0 || budget > 10_000_000 || !Number.isSafeInteger(balance?.value) || balance.value < budget) throw new Error('Fund the dedicated buyer with 0.01 test SOL before creating USDC accounts');
    const signer = await loadBuyerSigner(config.buyer);
    const latest = await solanaRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(config, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const message = appendTransactionMessageInstructions(missing.map(index => getCreateAssociatedTokenIdempotentInstruction({
      payer: signer, ata: address(atas[index]), owner: address(owners[index]), mint: address(config.mint),
    })), setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) },
      setTransactionMessageFeePayerSigner(signer, createTransactionMessage({ version: 0 }))));
    const simulation = await solanaRpc<{ value: { err: unknown } }>(config, 'simulateTransaction', [getBase64EncodedWireTransaction(compileTransaction(message)), { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
    if (simulation?.value?.err !== null) throw new Error('Account simulation failed; nothing signed');
    const transaction = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(transaction);
    // Save before submission. An uncertain result must never trigger a fresh transaction.
    await writeFile(join(directory, 'day4-accounts.json.tmp'), JSON.stringify({ binding, transaction: signature }), { mode: 0o600 });
    await rename(join(directory, 'day4-accounts.json.tmp'), join(directory, 'day4-accounts.json'));
    const submitted = await solanaRpc<string>(config, 'sendTransaction', [getBase64EncodedWireTransaction(transaction), { encoding: 'base64', skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed' }]);
    if (submitted !== signature) throw new Error('Unexpected submitted transaction');
    await confirmSolanaTransaction(config, signature);
    console.log(JSON.stringify({ accountsReady: true, created: missing.length, atas, transaction: signature }, null, 2));
  } finally { lock.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) setupWalletAccounts().catch(error => {
  console.error(error instanceof Error ? error.message : 'Account setup failed');
  process.exitCode = 1;
});
