import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireLocalRequest } from '../demo/local-request';

export const ConnectionSchema = z.object({
  origin: z.string().refine(value => {
    try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value; }
    catch { return false; }
  }),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const connectionFile = (directory: string) => join(directory, 'mcp-connection.json');

/** This capability only grants read-only Agent access, never management or signing. */
export class AgentConnection {
  private token?: string;
  private lastSeen: number | null = null;
  constructor(private directory: string) {
    // A new backend must not accept credentials left by an earlier process.
    this.removeFile();
  }
  private removeFile() {
    try { unlinkSync(connectionFile(this.directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  setEnabled(enabled: boolean, origin: string) {
    if (!enabled) { this.token = undefined; this.lastSeen = null; this.removeFile(); return; }
    const token = randomBytes(32).toString('base64url');
    const descriptor = ConnectionSchema.parse({ origin, token });
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${connectionFile(this.directory)}.tmp`;
    writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, connectionFile(this.directory));
    this.token = token;
    this.lastSeen = null;
  }
  authenticate(request: Request) {
    requireLocalRequest(request);
    if (request.headers.has('origin')) throw new Error('AGENT_UNAUTHORIZED');
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${this.token ?? ''}`);
    if (!this.token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('AGENT_UNAUTHORIZED');
    this.lastSeen = Date.now();
  }
  status() { return { enabled: Boolean(this.token), lastSeen: this.lastSeen, access: 'read_only' as const }; }
}

export function readConnection(directory: string) {
  return ConnectionSchema.parse(JSON.parse(readFileSync(connectionFile(directory), 'utf8')));
}
