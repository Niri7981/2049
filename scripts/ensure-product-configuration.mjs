import { closeSync, fsyncSync, lstatSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const directory = process.argv[2];
if (!directory || !isAbsolute(directory)) throw new Error('An absolute product data directory is required.');
const file = join(directory, 'product-configuration.json');

try {
  const existing = lstatSync(file);
  if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid()
    || (existing.mode & 0o077) !== 0) {
    throw new Error('Existing product configuration must be a private, owner-controlled regular file.');
  }
  // Existing installation choices are never replaced by a package upgrade.
  process.exit(0);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

// Fresh installations start with production execution disabled. All other
// payment prerequisites are chosen through the product and backend defaults.
const handle = openSync(file, 'wx', 0o600);
let complete = false;
try {
  writeFileSync(handle, JSON.stringify({ YOSH_ENABLE_MAINNET_EXECUTION: '0' }));
  fsyncSync(handle);
  complete = true;
} finally {
  closeSync(handle);
  if (!complete) rmSync(file, { force: true });
}
