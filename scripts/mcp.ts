import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentServer } from '../src/modules/mcp/server';
import { readConnection } from '../src/modules/mcp/connection';

const directory = process.env.APP2049_DATA_DIR || join(homedir(), 'Library', 'Application Support', '2049');
// Capture one connection capability. Revocation/re-enable requires a new MCP session.
let connection: ReturnType<typeof readConnection> | undefined;
const server = createAgentServer(async operation => {
  connection ??= readConnection(directory);
  const response = await fetch(`${connection.origin}/api/agent?operation=${operation}`, {
    headers: { authorization: `Bearer ${connection.token}` },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
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
});
server.connect(new StdioServerTransport()).catch(() => { console.error('2049 MCP could not start'); process.exitCode = 1; });
