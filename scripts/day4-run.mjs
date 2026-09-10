import { execFileSync, spawn } from 'node:child_process';

// Node reads proxy settings at startup. Inherit the user's existing macOS proxy.
const env = { ...process.env };
if (process.platform === 'darwin' && !env.HTTPS_PROXY && !env.https_proxy) {
  try {
    const settings = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 });
    const field = key => settings.match(new RegExp(`^\\s*${key} : (.+)$`, 'm'))?.[1]?.trim();
    const host = field('HTTPSProxy');
    const port = Number(field('HTTPSPort'));
    if (field('HTTPSEnable') === '1' && host && /^[a-zA-Z0-9.-]+$/.test(host) && port > 0 && port <= 65535) {
      env.HTTPS_PROXY = `http://${host}:${port}`;
      env.HTTP_PROXY ||= env.HTTPS_PROXY;
    }
  } catch { /* No system proxy: use the existing environment. */ }
}
env.NODE_USE_ENV_PROXY = '1';
env.NO_PROXY = [env.NO_PROXY || env.no_proxy, 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',');
const [target, ...args] = process.argv.slice(2);
const entries = { 'day7-preflight': 'scripts/day7-preflight.ts', 'day6-acceptance': 'scripts/day6-acceptance.ts', 'model-check': 'scripts/day5-model-check.ts', agent: 'scripts/day5-agent.ts', wallet: 'scripts/day4-wallet-setup.ts', accounts: 'scripts/day4-accounts.ts', preflight: 'scripts/day4-preflight.mjs', pay: 'scripts/day4-pay.ts' };
if (!['server', 'demo'].includes(target) && !entries[target]) throw new Error('Unknown demo command');
const command = ['server', 'demo'].includes(target)
  ? ['node_modules/next/dist/bin/next', target === 'demo' ? 'start' : 'dev', '--hostname', '127.0.0.1', ...args]
  : ['--import', 'tsx', '--env-file-if-exists=.env.local', entries[target], ...args];
const child = spawn(process.execPath, command, { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Could not start Day 4 command'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
