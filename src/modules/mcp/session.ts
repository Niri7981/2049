import { z } from 'zod';

export const McpSessionEventSchema = z.object({
  provider: z.literal('codex'),
  sessionId: z.string().uuid(),
  phase: z.enum(['initialized', 'heartbeat', 'closed']),
  sequence: z.number().int().nonnegative().safe(),
}).strict();
export type McpSessionEvent = z.infer<typeof McpSessionEventSchema>;
export const MCP_LIVENESS_MS = 30_000;

/** Volatile evidence only: restart and credential rotation must discard every lease. */
export class McpSessions {
  private sessions = new Map<string, { handshake: number; heartbeat: number; sequence: number }>();
  constructor(private now: () => number = Date.now) {}
  clear() { this.sessions.clear(); }
  observe(event: McpSessionEvent) {
    const now = this.now();
    const current = this.sessions.get(event.sessionId);
    if (event.phase === 'initialized') {
      if (event.sequence !== 0 || current) throw new Error('INVALID_MCP_SESSION');
      for (const [id, session] of this.sessions) {
        if (now < session.heartbeat || now - session.heartbeat >= MCP_LIVENESS_MS) this.sessions.delete(id);
      }
      if (this.sessions.size >= 64) throw new Error('MCP_SESSION_LIMIT');
      this.sessions.set(event.sessionId, { handshake: now, heartbeat: now, sequence: 0 });
      return;
    }
    if (!current || event.sequence <= current.sequence) throw new Error('INVALID_MCP_SESSION');
    if (event.phase === 'closed') { this.sessions.delete(event.sessionId); return; }
    if (now < current.heartbeat || now - current.heartbeat >= MCP_LIVENESS_MS) throw new Error('MCP_SESSION_EXPIRED');
    current.heartbeat = now;
    current.sequence = event.sequence;
  }
  status() {
    const now = this.now();
    const live = [...this.sessions.values()].filter(session => now >= session.heartbeat && now - session.heartbeat < MCP_LIVENESS_MS);
    return { connected: live.length > 0,
      lastHandshake: live.length ? Math.max(...live.map(session => session.handshake)) : null,
      lastHeartbeat: live.length ? Math.max(...live.map(session => session.heartbeat)) : null };
  }
}
