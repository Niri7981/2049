import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireLocalRequest } from '../demo/local-request';
import { SpendPrincipalSchema, type SpendPrincipal } from '../authority/spend-grant';

const CapabilitySchema = z.enum(['read', 'request_purchase']);
const agentCapabilities: Array<z.infer<typeof CapabilitySchema>> = ['read', 'request_purchase'];

export const ConnectionSchema = z.object({
  origin: z.string().refine(value => {
    try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value; }
    catch { return false; }
  }),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  cardMemberId: z.string().uuid(),
  connectionId: z.string().uuid(),
  generation: z.number().int().positive().safe(),
  capabilities: z.array(CapabilitySchema).min(1),
}).strict();
export const connectionFile = (directory: string) => join(directory, 'mcp-connection.json');

/** Agent capabilities never expose management operations, keys or arbitrary signing. */
export class AgentConnection {
  private descriptor?: z.infer<typeof ConnectionSchema>;
  private lastSeen: number | null = null;
  constructor(private directory: string, private cardMemberId: string, private isCardMemberActive: (id: string) => boolean) {
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
    if (!this.isCardMemberActive(this.cardMemberId)) throw new Error('CARD_MEMBER_REVOKED');
    const token = randomBytes(32).toString('base64url');
    this.write({ origin, token, cardMemberId: this.cardMemberId, connectionId: randomUUID(), generation: 1, capabilities: [...agentCapabilities] });
  }
  /** Grant changes invalidate the old token, without changing intent permissions. */
  rotateCredential(): SpendPrincipal | undefined {
    if (!this.descriptor) return undefined;
    if (!this.isCardMemberActive(this.descriptor.cardMemberId)) throw new Error('CARD_MEMBER_REVOKED');
    const next: z.infer<typeof ConnectionSchema> = { ...this.descriptor, token: randomBytes(32).toString('base64url'), generation: this.descriptor.generation + 1, capabilities: [...agentCapabilities] };
    this.write(next);
    return SpendPrincipalSchema.parse({ cardMemberId: next.cardMemberId, connectionId: next.connectionId, connectionGeneration: next.generation });
  }
  principal(capability: z.infer<typeof CapabilitySchema>): SpendPrincipal | undefined {
    const value = this.descriptor;
    if (!value?.capabilities.includes(capability)) return undefined;
    if (!this.isCardMemberActive(value.cardMemberId)) return undefined;
    return { cardMemberId: value.cardMemberId, connectionId: value.connectionId, connectionGeneration: value.generation };
  }
  authenticate(request: Request, capability: z.infer<typeof CapabilitySchema> = 'read') {
    requireLocalRequest(request);
    if (request.headers.has('origin')) throw new Error('AGENT_UNAUTHORIZED');
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    const token = this.descriptor?.token;
    const expected = Buffer.from(`Bearer ${token ?? ''}`);
    if (!token || !this.descriptor?.capabilities.includes(capability) || !this.isCardMemberActive(this.descriptor.cardMemberId)
      || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('AGENT_UNAUTHORIZED');
    this.lastSeen = Date.now();
    return { cardMemberId: this.descriptor.cardMemberId, connectionId: this.descriptor.connectionId, connectionGeneration: this.descriptor.generation };
  }
  status() {
    const enabled = Boolean(this.descriptor && this.isCardMemberActive(this.descriptor.cardMemberId));
    const capabilities = enabled ? this.descriptor?.capabilities ?? [] : [];
    return { enabled, lastSeen: this.lastSeen, access: capabilities.includes('request_purchase') ? 'purchase_intent' as const : 'read_only' as const, capabilities };
  }
}

export function readConnection(directory: string) {
  return ConnectionSchema.parse(JSON.parse(readFileSync(connectionFile(directory), 'utf8')));
}
