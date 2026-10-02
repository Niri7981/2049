import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { createAgentServer } from '../src/modules/mcp/server';
import { readConnection } from '../src/modules/mcp/connection';
import { appRequestTimeout } from '../src/modules/mcp/request-timeout';

const directory = process.env.APP2049_DATA_DIR || join(homedir(), 'Library', 'Application Support', '2049');
const memberId = process.env.APP2049_CARD_MEMBER_ID;
// Capture one connection capability. Revocation/re-enable requires a new MCP session.
let connection: ReturnType<typeof readConnection> | undefined;
async function callApp(path: string, init?: RequestInit) {
  connection ??= readConnection(directory, memberId);
  const response = await fetch(`${connection.origin}${path}`, {
    headers: { authorization: `Bearer ${connection.token}` },
    redirect: 'error', signal: AbortSignal.timeout(appRequestTimeout(path)), ...init,
    ...(init?.body ? { headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' } } : {}),
  });
  if (!response.ok) throw new Error('APP_UNAVAILABLE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('APP_UNAVAILABLE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 65_536) throw new Error('RESPONSE_TOO_LARGE'); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const server = createAgentServer(
  operation => callApp(`/api/agent?operation=${operation}`),
  input => callApp('/api/agent/purchases', { method: 'POST', body: JSON.stringify(input) }),
);
if (process.env.APP2049_MCP_PROVIDER === 'codex') {
  const sessionId = randomUUID();
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const report = (phase: 'initialized' | 'heartbeat' | 'closed') => callApp('/api/agent/session', {
    method: 'POST', body: JSON.stringify({ provider: 'codex', sessionId, phase, sequence: sequence++ }),
  });
  const stop = () => { closed = true; clearTimeout(timer); };
  const pulse = async (initial = false) => {
    try {
      // A running bridge alone is not host liveness: require a fresh MCP host response.
      await server.server.request({ method: 'ping' }, EmptyResultSchema, { timeout: 5_000 });
      if (closed) return;
      await report(initial ? 'initialized' : 'heartbeat');
      if (!closed) timer = setTimeout(() => { void pulse(); }, 10_000);
    } catch {
      stop();
      // Backend loss, revocation or a dead host ends this capability; never reload a new token here.
      await server.close().catch(() => {});
    }
  };
  server.server.oninitialized = () => { void pulse(true); };
  server.server.onclose = () => { stop(); void report('closed').catch(() => {}); };
  process.stdin.on('end', () => { stop(); void server.close(); });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { stop(); void server.close(); });
}
server.connect(new StdioServerTransport()).catch(() => { console.error('2049 MCP could not start'); process.exitCode = 1; });
