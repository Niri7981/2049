import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentConnection } from '../../src/modules/mcp/connection';

it('connects the real stdio bridge from another cwd and does not reacquire revoked access', async () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-stdio-'));
  const connection = new AgentConnection(directory);
  const operations: string[] = [];
  const http = createServer((incoming, outgoing) => {
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${address.port}`);
    try {
      connection.authenticate(new Request(url, { headers: { authorization: incoming.headers.authorization ?? '' } }));
      operations.push(url.searchParams.get('operation') ?? '');
      outgoing.setHeader('content-type', 'application/json');
      outgoing.end(JSON.stringify({ paymentEnabled: false }));
    } catch { outgoing.writeHead(401); outgoing.end(); }
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const origin = `http://127.0.0.1:${address.port}`;
  connection.setEnabled(true, origin);
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/mcp.ts')],
    cwd: tmpdir(), env: { APP2049_DATA_DIR: directory }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'get_spending_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(operations).toEqual(['status']);
    connection.setEnabled(false, origin);
    connection.setEnabled(true, origin);
    const revoked = await client.callTool({ name: 'get_market_quote', arguments: {} });
    expect(revoked.isError).toBe(true);
    expect(operations).toEqual(['status']);
  } finally {
    await client.close(); await transport.close();
    await new Promise<void>(done => http.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

it('sends request_purchase through the spend-authorized POST bridge without payment fields', async () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-stdio-request-'));
  const connection = new AgentConnection(directory);
  let received: { url?: string; method?: string; body?: unknown } = {};
  const resource = { asset: 'SOL', as_of: '2026-09-05T08:00:00Z', spot_price_usd: 140, change_24h_pct: 2.4,
    volume_24h_usd: 3_000_000_000, market_cap_usd: 75_000_000_000, volatility_7d_pct: 5.8, rsi_14d: 57,
    support_levels_usd: [132, 136], resistance_levels_usd: [145, 151], source_label: 'Demo snapshot fixture', is_demo_snapshot: true };
  const purchase = { purchaseId: 'stdio-request-1', decision: { decision: 'APPROVED' }, paymentStatus: 'PAID',
    deliveryStatus: 'COMPLETE', reused: false, amount: '200000', resource };
  const http = createServer((incoming, outgoing) => {
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${address.port}`);
    try {
      connection.authenticate(new Request(url, { headers: { authorization: incoming.headers.authorization ?? '' } }), 'request_purchase');
      const chunks: Buffer[] = [];
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        received = { url: url.pathname, method: incoming.method, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify(purchase));
      });
    } catch { outgoing.writeHead(401); outgoing.end(); }
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const origin = `http://127.0.0.1:${address.port}`;
  connection.setEnabled(true, origin); connection.rotateForSpending();
  const client = new Client({ name: 'stdio-request-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/mcp.ts')], cwd: tmpdir(),
    env: { APP2049_DATA_DIR: directory }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'request_purchase', arguments: { requestId: 'stdio-request-1', offerId: 'basic', reason: 'Need SOL data' } });
    expect(result.isError).not.toBe(true);
    expect(received).toEqual({ url: '/api/agent/purchases', method: 'POST', body: { requestId: 'stdio-request-1', offerId: 'basic', reason: 'Need SOL data' } });
    expect(result).toMatchObject({ content: [{ type: 'text', text: JSON.stringify(purchase) }] });
  } finally {
    await client.close(); await transport.close();
    await new Promise<void>(done => http.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
