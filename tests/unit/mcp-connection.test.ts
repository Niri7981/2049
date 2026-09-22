import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentConnection, connectionFile, readConnection } from '../../src/modules/mcp/connection';
import { createAgentServer } from '../../src/modules/mcp/server';
import { requireManagementRequest } from '../../src/modules/app/management-auth';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), '2049-mcp-')); dirs.push(dir);
  const connection = new AgentConnection(dir);
  return { dir, connection };
}
const origin = 'http://127.0.0.1:3049';
const request = (token: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/agent?operation=status`, {
  headers: { authorization: `Bearer ${token}`, ...headers },
});

it('separates Agent and management access, rejects browsers and publishes no token in status', () => {
  const { dir, connection } = fixture();
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', 'm'.repeat(43));
  expect(() => connection.authenticate(request('m'.repeat(43)))).toThrow();
  connection.setEnabled(true, origin);
  const { token } = readConnection(dir);
  expect(statSync(connectionFile(dir)).mode & 0o777).toBe(0o600);
  expect(() => requireManagementRequest(request(token))).toThrow('UNAUTHORIZED');
  expect(() => connection.authenticate(request('m'.repeat(43)))).toThrow();
  expect(() => connection.authenticate(request(token, { origin }))).toThrow();
  expect(() => connection.authenticate(request(token, { 'sec-fetch-site': 'cross-site' }))).toThrow();
  connection.authenticate(request(token));
  expect(connection.status()).toMatchObject({ enabled: true, lastSeen: expect.any(Number), access: 'read_only' });
  expect(JSON.stringify(connection.status())).not.toContain(token);
});

it('revokes old credentials across disable, re-enable and backend restart', () => {
  const { dir, connection } = fixture();
  connection.setEnabled(true, origin);
  const first = readConnection(dir).token;
  connection.setEnabled(false, origin);
  expect(existsSync(connectionFile(dir))).toBe(false);
  expect(() => connection.authenticate(request(first))).toThrow();
  connection.setEnabled(true, origin);
  const second = readConnection(dir).token;
  expect(second).not.toBe(first);
  expect(() => connection.authenticate(request(first))).toThrow();
  connection.authenticate(request(second));
  const restarted = new AgentConnection(dir);
  expect(() => restarted.authenticate(request(second))).toThrow();
  expect(existsSync(connectionFile(dir))).toBe(false);
});

it('rotates the credential when spending is granted or revoked', () => {
  const { dir, connection } = fixture();
  connection.setEnabled(true, origin);
  const readOnly = readConnection(dir);
  expect(() => connection.authenticate(request(readOnly.token), 'request_purchase')).toThrow();
  const principal = connection.rotateForSpending();
  const spending = readConnection(dir);
  expect(spending.token).not.toBe(readOnly.token);
  expect(spending.capabilities).toEqual(['read', 'request_purchase']);
  expect(principal).toEqual({ connectionId: spending.connectionId, connectionGeneration: spending.generation });
  expect(() => connection.authenticate(request(readOnly.token))).toThrow();
  connection.authenticate(request(spending.token), 'request_purchase');
  connection.downgradeToReadOnly();
  expect(() => connection.authenticate(request(spending.token), 'request_purchase')).toThrow();
});

it('uses the official MCP handshake and exposes a request-only purchase tool with sanitized failures', async () => {
  const read = vi.fn().mockResolvedValue({ amount: '10000', paymentEnabled: false });
  const requestPurchase = vi.fn().mockResolvedValue({ status: 'APPROVED', paymentStatus: 'NOT_STARTED' });
  const server = createAgentServer(read, requestPurchase);
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(['get_spending_status', 'get_market_quote', 'request_purchase']);
    const results = await Promise.all(Array.from({ length: 3 }, () => client.callTool({ name: 'get_market_quote', arguments: {} })));
    expect(results.every(result => !result.isError)).toBe(true);
    expect(read.mock.calls).toEqual([['quote'], ['quote'], ['quote']]);
    const unknown = await client.callTool({ name: 'pay', arguments: { approved: true } });
    expect(unknown.isError).toBe(true); expect(read).toHaveBeenCalledTimes(3);
    const requested = await client.callTool({ name: 'request_purchase', arguments: { requestId: 'request-1', offerId: 'basic', reason: 'Need SOL data' } });
    expect(requested.isError).not.toBe(true);
    expect(requestPurchase).toHaveBeenCalledWith({ requestId: 'request-1', offerId: 'basic', reason: 'Need SOL data' });
    read.mockRejectedValueOnce(new Error('secret-token-and-rpc-url'));
    const failed = await client.callTool({ name: 'get_spending_status', arguments: {} });
    expect(failed.isError).toBe(true); expect(JSON.stringify(failed)).not.toContain('secret-token');
  } finally { await client.close(); await server.close(); }
});
