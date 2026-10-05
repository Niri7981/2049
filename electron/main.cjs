/* Electron's main entry is intentionally CommonJS so packaged and development launches use the same file. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron');
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { resolveYoshConfiguration } = require('../src/modules/app/yosh-configuration.ts');

const host = '127.0.0.1';
const configuration = resolveYoshConfiguration();
const port = Number(configuration.port ?? 3049);
const repositoryRoot = configuration.repositoryRoot ?? process.cwd();
// Keep both persistence and Electron's single-instance lock on the installation's
// existing store before changing the public application name.
const dataDirectory = configuration.dataDirectory ?? path.join(app.getPath('appData'), '2049');
if (!path.isAbsolute(dataDirectory)) throw new Error('Yosh requires an absolute data directory');
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
app.setPath('userData', dataDirectory);
const origin = `http://${host}:${port}`;
const token = randomBytes(32).toString('base64url');
let window;
let tray;
let service;
let quitting = false;
let quitRequested = false;
let serviceReady = false;

app.setName('Yosh');
if (!app.requestSingleInstanceLock()) app.quit();

async function serviceRequest(route, method = 'GET', body) {
  const wireBody = body === undefined ? undefined : JSON.stringify(body);
  const nonce = randomBytes(32).toString('hex');
  const timestamp = String(Date.now());
  const hash = value => createHash('sha256').update(value).digest('hex');
  const message = ['2049-management-v1', method, route, timestamp, nonce, hash(wireBody ?? '')].join('\n');
  const response = await fetch(`${origin}${route}`, { method, headers: { origin,
    'x-2049-timestamp': timestamp, 'x-2049-nonce': nonce, 'x-2049-body-sha256': hash(wireBody ?? ''),
    'x-2049-proof': createHmac('sha256', token).update(message).digest('hex'),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: wireBody,
    redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const maximum = ['/api/app/health', '/api/app/lifecycle'].includes(route) ? 4096 : 65_536;
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) throw new Error('Management response too large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const bytes = Buffer.concat(chunks);
  const signature = response.headers.get('x-2049-response-proof') ?? '';
  const reply = ['2049-management-response-v1', nonce, String(response.status), hash(bytes)].join('\n');
  if (!/^[a-f0-9]{64}$/.test(signature)
    || !timingSafeEqual(Buffer.from(signature, 'hex'), createHmac('sha256', token).update(reply).digest()))
    throw new Error('Management response authentication failed');
  return new Response(bytes, { status: response.status, headers: response.headers });
}

async function waitForService() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await serviceRequest('/api/app/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local service did not start');
}

function startService() {
  const next = path.join(repositoryRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const command = app.isPackaged ? 'start' : 'dev';
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', YOSH_MANAGEMENT_TOKEN: token,
    YOSH_DATA_DIR: dataDirectory, NODE_USE_ENV_PROXY: '1' };
  // Validate aliases above, then replace both inherited spellings with one child identity.
  if (env.APP2049_MANAGEMENT_TOKEN !== undefined) env.APP2049_MANAGEMENT_TOKEN = token;
  if (env.APP2049_DATA_DIR !== undefined) env.APP2049_DATA_DIR = dataDirectory;
  if (process.platform === 'darwin' && !env.HTTPS_PROXY && !env.https_proxy) {
    try {
      const settings = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 });
      const field = key => settings.match(new RegExp(`^\\s*${key} : (.+)$`, 'm'))?.[1]?.trim();
      const proxyHost = field('HTTPSProxy'); const proxyPort = Number(field('HTTPSPort'));
      if (field('HTTPSEnable') === '1' && proxyHost && /^[a-zA-Z0-9.-]+$/.test(proxyHost) && proxyPort > 0 && proxyPort <= 65535) {
        env.HTTPS_PROXY = `http://${proxyHost}:${proxyPort}`; env.HTTP_PROXY ||= env.HTTPS_PROXY;
      }
    } catch { /* No readable system proxy; the balance endpoint will fail closed. */ }
  }
  env.NO_PROXY = [env.NO_PROXY || env.no_proxy, 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',');
  service = spawn(process.execPath, [next, command, '--hostname', host, '--port', String(port)], { cwd: repositoryRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'] });
  service.stdout.on('data', chunk => process.stdout.write(chunk));
  service.stderr.on('data', chunk => process.stderr.write(chunk));
  service.on('exit', code => { if (!quitting) console.error(`Yosh local service stopped (${code ?? 'signal'})`); });
}

function showWindow() { if (window) { window.show(); window.focus(); } }
async function setPaused(paused) {
  const response = await serviceRequest('/api/app/settings', 'PUT', { paused });
  if (!response.ok) throw new Error('Could not update payment pause state');
  await window?.webContents.reload();
}
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 Yosh', click: showWindow },
    { type: 'separator' },
    { label: '暂停付款', click: () => void setPaused(true) },
    { label: '继续付款', click: () => void setPaused(false) },
    { type: 'separator' },
    { label: '退出 Yosh', click: () => app.quit() },
  ]);
}

ipcMain.handle('yosh:request', async (_event, route, options = {}) => {
  const allowed = new Map([['/api/app/overview', ['GET']], ['/api/app/balance', ['GET']], ['/api/app/settings', ['PUT']], ['/api/app/connection', ['PUT']], ['/api/app/grant', ['PUT']], ['/api/app/test-purchases', ['POST']]]);
  const method = typeof options.method === 'string' ? options.method : 'GET';
  if (typeof route !== 'string' || !allowed.get(route)?.includes(method)) return { ok: false, status: 400, body: { error: '不支持的管理操作。' } };
  try {
    const response = await serviceRequest(route, method, options.body);
    return { ok: response.ok, status: response.status, body: await response.json() };
  } catch { return { ok: false, status: 503, body: { error: '本地服务暂时不可用。' } }; }
});

app.on('second-instance', showWindow);
app.whenReady().then(async () => {
  startService();
  await waitForService();
  serviceReady = true;
  window = new BrowserWindow({ width: 780, height: 720, minWidth: 640, minHeight: 560, title: 'Yosh', webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${origin}/`) && url !== origin) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadURL(origin);
  const image = nativeImage.createFromNamedImage('NSStatusAvailable');
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Yosh');
  tray.setContextMenu(buildMenu());
  tray.on('click', showWindow);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Yosh', submenu: [
    { label: '关于 Yosh', role: 'about' }, { type: 'separator' }, { label: '隐藏 Yosh', role: 'hide' }, { label: '退出 Yosh', click: () => app.quit() },
  ] }, { label: '窗口', submenu: [{ label: '打开主窗口', click: showWindow }, { role: 'minimize' }] }]));
}).catch(error => { console.error(error instanceof Error ? error.message : 'Yosh failed to start'); app.quit(); });

app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (quitRequested) return;
  quitRequested = true;
  void (async () => {
    // A timeout is not permission to kill a signer. Retry the idempotent drain.
    while (serviceReady && service && service.exitCode === null && service.signalCode === null) {
      try {
        const response = await serviceRequest('/api/app/lifecycle', 'POST', { action: 'prepareQuit' });
        if (response.ok && (await response.json()).ready === true) break;
      } catch { /* Continue waiting for durable payment state or service exit. */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    quitting = true;
    if (service && service.exitCode === null && service.signalCode === null) {
      await new Promise(resolve => { service.once('exit', resolve); service.kill('SIGTERM'); });
    }
    app.quit();
  })();
});
app.on('window-all-closed', () => {});
