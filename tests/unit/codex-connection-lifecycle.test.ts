import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRuntime } from '../../src/modules/app/app-runtime';
import { ManagementApiError } from '../../src/modules/app/management-auth';
import { CodexIntegration } from '../../src/modules/mcp/codex-integration';
import { connectionFile, readConnection } from '../../src/modules/mcp/connection';
import { POST } from '../../src/app/api/agent/session/route';

const origin = 'http://127.0.0.1:3049';
const directories: string[] = [];
const globals = globalThis as typeof globalThis & { __app2049?: { runtime?: AppRuntime } };
afterEach(() => { globals.__app2049 = undefined; vi.restoreAllMocks(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '2049-codex-lifecycle-')); directories.push(directory);
  const app = new AppRuntime(directory); globals.__app2049 = { runtime: app };
  return { app, memberId: app.ledger.defaultCardMember().id };
}
const agent = (token: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/agent/session`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const initial = { provider: 'codex', sessionId: '22222222-2222-4222-8222-222222222222', phase: 'initialized', sequence: 0 };

it('serializes concurrent Connect and preserves a member credential and grant on repeated Connect', async () => {
  vi.spyOn(CodexIntegration.prototype, 'connect').mockResolvedValue();
  const { app, memberId } = fixture();
  try {
    await Promise.all([app.setMemberConnection(true, origin, memberId), app.setMemberConnection(true, origin, memberId)]);
    const first = readConnection(app.directory, memberId);
    app.createSpendGrant({ totalLimit: '500000', singleLimit: '200000', expiresAt: Date.now() + 3_600_000 });
    const rotated = readConnection(app.directory, memberId);
    await app.setMemberConnection(true, origin, memberId);
    expect(readConnection(app.directory, memberId)).toEqual(rotated);
    expect(first.connectionId).toBe(rotated.connectionId);
    expect(app.spendGrantSummary()?.status).toBe('ACTIVE');
  } finally { app.close(); }
});

it('revokes access and delegation even when removing user-modified Codex config fails', async () => {
  vi.spyOn(CodexIntegration.prototype, 'connect').mockResolvedValue();
  vi.spyOn(CodexIntegration.prototype, 'disconnect').mockRejectedValue(new ManagementApiError('CODEX_CONFIG_CONFLICT', 409, 'Fixture conflict'));
  const { app, memberId } = fixture();
  try {
    await app.setMemberConnection(true, origin, memberId);
    app.createSpendGrant({ totalLimit: '500000', singleLimit: '200000', expiresAt: Date.now() + 3_600_000 });
    const { token } = readConnection(app.directory, memberId);
    await expect(app.setMemberConnection(false, origin, memberId)).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
    expect(app.agentConnection.status()).toMatchObject({ enabled: false, integration: { connected: false } });
    expect(app.spendGrantSummary()?.status).toBe('REVOKED');
    expect((await POST(agent(token, initial))).status).toBe(401);
  } finally { app.close(); }
});

it('waits for in-flight configuration during quit and never issues a capability after quit begins', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const configured = vi.spyOn(CodexIntegration.prototype, 'connect').mockReturnValue(pending);
  const { app, memberId } = fixture();
  const connecting = app.setMemberConnection(true, origin, memberId);
  const rejected = expect(connecting).rejects.toMatchObject({ code: 'SERVICE_STOPPING' });
  await vi.waitFor(() => expect(configured).toHaveBeenCalledOnce());
  const quitting = app.prepareQuit();
  release();
  await rejected; await quitting;
  expect(app.agentConnection.status().enabled).toBe(false);
  expect(existsSync(connectionFile(app.directory))).toBe(false);
  app.close();
});

it('requires an authenticated, configured Member for session reports and rejects replay and provider spoofing', async () => {
  vi.spyOn(CodexIntegration.prototype, 'connect').mockResolvedValue();
  const { app, memberId } = fixture();
  try {
    await app.setMemberConnection(true, origin, memberId);
    const { token } = readConnection(app.directory, memberId);
    const second = app.createCardMember('Codex').member.id;
    app.setAgentConnection(true, origin, second);
    const other = readConnection(app.directory, second);
    expect((await POST(agent('wrong', initial))).status).toBe(401);
    expect((await POST(agent(token, initial, { origin }))).status).toBe(401);
    expect((await POST(agent(token, { ...initial, provider: 'claude' }))).status).toBe(409);
    expect((await POST(agent(other.token, initial))).status).toBe(409);
    expect(app.agentConnection.status().integration?.connected).toBe(false);
    expect((await POST(agent(token, initial))).status).toBe(200);
    expect((await POST(agent(token, initial))).status).toBe(409);
    expect((await POST(agent(token, { ...initial, phase: 'heartbeat', sequence: 1 }))).status).toBe(200);
    expect((await POST(agent(token, { ...initial, phase: 'heartbeat', sequence: 1 }))).status).toBe(409);
    app.agentConnection.rotateCredential();
    expect((await POST(agent(token, { ...initial, phase: 'heartbeat', sequence: 2 }))).status).toBe(401);
    expect(app.agentConnection.status().integration?.connected).toBe(false);
  } finally { app.close(); }
});
