import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireLocalRequest } from '../demo/local-request';
import { SpendPrincipalSchema, type SpendPrincipal } from '../authority/spend-grant';

const CapabilitySchema = z.enum(['read', 'request_purchase']);

export const ConnectionSchema = z.object({
  origin: z.string().refine(value => {
    try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value; }
    catch { return false; }
  }),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  connectionId: z.string().uuid(),
  generation: z.number().int().positive().safe(),
  capabilities: z.array(CapabilitySchema).min(1),
}).strict();
export const connectionFile = (directory: string) => join(directory, 'mcp-connection.json');

/** Agent capabilities never expose management operations, keys or arbitrary signing. */
export class AgentConnection {
  private descriptor?: z.infer<typeof ConnectionSchema>;
  private lastSeen: number | null = null;
  constructor(private directory: string) {
    // A new backend must not accept credentials left by an earlier process.
    this.removeFile();
  }
  private removeFile() {
    try { unlinkSync(connectionFile(this.directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private write(descriptor: z.infer<typeof ConnectionSchema>) {
    const parsed = ConnectionSchema.parse(descriptor);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${connectionFile(this.directory)}.tmp`;
    writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, connectionFile(this.directory));
    this.descriptor = parsed;
    this.lastSeen = null;
  }
  setEnabled(enabled: boolean, origin: string) {
    if (!enabled) { this.descriptor = undefined; this.lastSeen = null; this.removeFile(); return; }
    const token = randomBytes(32).toString('base64url');
    this.write({ origin, token, connectionId: randomUUID(), generation: 1, capabilities: ['read'] });
  }
  rotateForSpending(): SpendPrincipal {
    if (!this.descriptor) throw new Error('请先启用 Agent 连接。');
    const next: z.infer<typeof ConnectionSchema> = { ...this.descriptor, token: randomBytes(32).toString('base64url'), generation: this.descriptor.generation + 1, capabilities: ['read', 'request_purchase'] };
    this.write(next);
    return SpendPrincipalSchema.parse({ connectionId: next.connectionId, connectionGeneration: next.generation });
  }
  downgradeToReadOnly() {
    if (!this.descriptor) return;
    this.write({ ...this.descriptor, token: randomBytes(32).toString('base64url'), generation: this.descriptor.generation + 1, capabilities: ['read'] });
  }
  principal(capability: z.infer<typeof CapabilitySchema>): SpendPrincipal | undefined {
    const value = this.descriptor;
    if (!value?.capabilities.includes(capability)) return undefined;
    return { connectionId: value.connectionId, connectionGeneration: value.generation };
  }
  authenticate(request: Request, capability: z.infer<typeof CapabilitySchema> = 'read') {
    requireLocalRequest(request);
    if (request.headers.has('origin')) throw new Error('AGENT_UNAUTHORIZED');
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    const token = this.descriptor?.token;
    const expected = Buffer.from(`Bearer ${token ?? ''}`);
    if (!token || !this.descriptor?.capabilities.includes(capability) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('AGENT_UNAUTHORIZED');
    this.lastSeen = Date.now();
    return { connectionId: this.descriptor.connectionId, connectionGeneration: this.descriptor.generation };
  }
  status() {
    const capabilities = this.descriptor?.capabilities ?? [];
    return { enabled: Boolean(this.descriptor), lastSeen: this.lastSeen, access: capabilities.includes('request_purchase') ? 'spending_request' as const : 'read_only' as const, capabilities };
  }
}

export function readConnection(directory: string) {
  return ConnectionSchema.parse(JSON.parse(readFileSync(connectionFile(directory), 'utf8')));
}
