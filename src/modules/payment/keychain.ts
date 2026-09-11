import { spawn } from "node:child_process";
import { address } from "@solana/kit";

function validateItem(service: string, account: string) {
  if (!/^com\.2049\.day4\.[a-f0-9]{16}$/.test(service)) throw new Error("Invalid Demo keychain service");
  address(account);
  if (process.platform !== "darwin") throw new Error("Demo keychain signing requires macOS");
}

function security(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Demo keychain access timed out")); }, 30_000);
    child.stdout.on("data", chunk => { output += chunk; });
    // Never forward security's diagnostic streams: they can include command input.
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("Demo keychain is unavailable")); });
    child.stdin.on("error", () => {});
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Demo keychain access failed; unlock your login keychain"));
      else resolve(output.trim());
    });
    child.stdin.end(input);
  });
}

export async function readDemoKeychain(service: string, account: string): Promise<string> {
  validateItem(service, account);
  const secret = await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(secret)) throw new Error("Invalid Demo keychain signer");
  return secret;
}

export async function createDemoKeychain(service: string, account: string, secret: string): Promise<void> {
  validateItem(service, account);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(secret)) throw new Error("Invalid Demo signer encoding");
  // Interactive stdin keeps secret bytes out of process argv and shell history.
  // No -A, ACL changes or -U: do not broaden access or replace an existing item.
  await security(["-i"], `add-generic-password -s ${service} -a ${account} -w ${secret}\n`);
  if (await readDemoKeychain(service, account) !== secret) throw new Error("Demo signer was not saved; configuration was not changed");
}
