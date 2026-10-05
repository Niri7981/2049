import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AgentConnection, readConnection } from '../../src/modules/mcp/connection';
import { MCP_LIVENESS_MS, McpSessionEventSchema } from '../../src/modules/mcp/session';

const memberId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture() {
  let now = 1_800_000_000_000;
  const directory = mkdtempSync(join(tmpdir(), 'yosh-session-')); directories.push(directory);
  const connection = new AgentConnection(directory, memberId, () => true, false, () => now);
  connection.setIntegration(true, `2049-codex-${memberId}`);
  connection.setEnabled(true, 'http://127.0.0.1:3049');
  return { connection, directory, advance: (ms: number) => { now += ms; } };
}
const event = (phase: 'initialized' | 'heartbeat' | 'closed', sequence: number) => ({ provider: 'codex' as const, sessionId, phase, sequence });

it('keeps credentials and ordinary authenticated requests separate from MCP liveness', () => {
  const { connection, directory } = fixture();
  const descriptor = readConnection(directory, memberId);
  connection.authenticate(new Request(`${descriptor.origin}/api/agent`, { headers: { authorization: `Bearer ${descriptor.token}` } }));
  expect(connection.status()).toMatchObject({ enabled: true, integration: { connected: false, state: 'reconnect_required' } });
  connection.observeSession(event('initialized', 0));
  expect(connection.status().integration).toMatchObject({ connected: true, lastHandshake: 1_800_000_000_000, lastHeartbeat: 1_800_000_000_000 });
  expect(JSON.stringify(connection.status())).not.toContain(descriptor.token);
});

it('rejects replay, heartbeat before initialization, expired leases and clock rollback', () => {
  const { connection, advance } = fixture();
  expect(() => connection.observeSession(event('heartbeat', 1))).toThrow();
  connection.observeSession(event('initialized', 0));
  expect(() => connection.observeSession(event('initialized', 0))).toThrow();
  advance(10_000); connection.observeSession(event('heartbeat', 1));
  expect(() => connection.observeSession(event('heartbeat', 1))).toThrow();
  advance(MCP_LIVENESS_MS);
  expect(connection.status().integration?.connected).toBe(false);
  expect(() => connection.observeSession(event('heartbeat', 2))).toThrow('MCP_SESSION_EXPIRED');
  advance(-MCP_LIVENESS_MS - 1);
  expect(connection.status().integration?.connected).toBe(false);
});

it('clears all evidence on rotation and disable, and cannot route another member to the default capability', () => {
  const { connection, directory } = fixture();
  connection.observeSession(event('initialized', 0));
  connection.rotateCredential();
  expect(connection.status().integration?.connected).toBe(false);
  expect(() => connection.observeSession(event('heartbeat', 1))).toThrow();
  connection.observeSession(event('initialized', 0));
  connection.observeSession(event('closed', 1));
  expect(connection.status().integration?.connected).toBe(false);
  connection.setEnabled(false, '');
  expect(() => connection.observeSession(event('initialized', 0))).toThrow();
  connection.setEnabled(true, 'http://127.0.0.1:3049');
  expect(() => readConnection(directory, sessionId)).toThrow('MCP_MEMBER_MISMATCH');
  expect(McpSessionEventSchema.safeParse({ ...event('initialized', 0), provider: 'claude' }).success).toBe(false);
});
