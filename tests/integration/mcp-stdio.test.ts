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
