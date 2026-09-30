import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AppRuntime } from '../../src/modules/app/app-runtime';
import { connectionFile, readConnection } from '../../src/modules/mcp/connection';
import { GET, POST } from '../../src/app/api/app/members/route';
import { DELETE, GET as GETMember, PUT as PUTMember } from '../../src/app/api/app/members/[memberId]/route';
import { PUT as PUTConnection } from '../../src/app/api/app/members/[memberId]/connection/route';
import { PUT as PUTGrant } from '../../src/app/api/app/members/[memberId]/grant/route';
import { signedManagementRequest } from '../helpers/management-request';

const directories: string[] = [];
const token = 'm'.repeat(48);
const origin = 'http://127.0.0.1:3049';
const now = Date.parse('2026-09-28T00:00:00Z');
const globals = globalThis as typeof globalThis & { __app2049?: { runtime?: AppRuntime } };
function runtime() {
  const directory = mkdtempSync(join(tmpdir(), '2049-members-')); directories.push(directory);
  return new AppRuntime(directory, { now: () => now });
}
function request(path: string, method = 'GET', body?: unknown, secret = token, requestOrigin = origin) {
  return signedManagementRequest(`${origin}${path}`, secret, { method, headers: {
    host: '127.0.0.1:3049', origin: requestOrigin, 'content-type': 'application/json',
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function agentRequest(authorization: string) {
  return new Request(`${origin}/api/agent`, { headers: { host: '127.0.0.1:3049', authorization } });
}
afterEach(() => {
  globals.__app2049 = undefined;
  delete process.env.APP2049_MANAGEMENT_TOKEN;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('isolates live member credentials and grants, then invalidates them on revoke and restart', () => {
  const app = runtime();
  const directory = app.directory;
  const defaultId = app.ledger.defaultCardMember().id;
  const second = app.createCardMember('Research');
  const id = second.member.id;
  try {
    app.setAgentConnection(true, origin);
    app.setAgentConnection(true, origin, id);
    const firstConnection = readConnection(directory);
    const secondConnection = readConnection(directory, id);
    expect(firstConnection.cardMemberId).toBe(defaultId);
    expect(secondConnection.cardMemberId).toBe(id);
    expect(secondConnection.token).not.toBe(firstConnection.token);
    expect(app.authenticateAgent(agentRequest(`Bearer ${secondConnection.token}`)).cardMemberId).toBe(id);
    app.createSpendGrant({ totalLimit: '500000', singleLimit: '200000', expiresAt: now + 3_600_000 });
    app.createSpendGrant({ totalLimit: '300000', singleLimit: '100000', expiresAt: now + 3_600_000 }, id);
    expect(app.spendGrantSummary(defaultId)?.status).toBe('ACTIVE');
    expect(app.spendGrantSummary(id)?.status).toBe('ACTIVE');
    app.revokeCardMember(id);
    expect(existsSync(connectionFile(directory, id))).toBe(false);
    expect(app.spendGrantSummary(id)?.status).toBe('REVOKED');
    expect(app.spendGrantSummary(defaultId)?.status).toBe('ACTIVE');
    expect(() => app.authenticateAgent(agentRequest(`Bearer ${secondConnection.token}`))).toThrow('AGENT_UNAUTHORIZED');
    expect(app.authenticateAgent(agentRequest(`Bearer ${readConnection(directory).token}`)).cardMemberId).toBe(defaultId);
    expect(() => app.revokeCardMember(defaultId)).toThrow('DEFAULT_CARD_MEMBER_REQUIRED');
  } finally { app.close(); }

  const reopened = new AppRuntime(directory, { now: () => now });
  try {
    expect(reopened.memberOverview(id).member).toMatchObject({ label: 'Research', status: 'REVOKED' });
    expect(reopened.memberOverview(defaultId).connection.enabled).toBe(false);
    expect(reopened.spendGrantSummary(defaultId)?.status).toBe('REVOKED');
    expect(existsSync(connectionFile(directory))).toBe(false);
  } finally { reopened.close(); }
});

it('requires management auth and same-origin writes for member routes', async () => {
  const app = runtime(); globals.__app2049 = { runtime: app };
  process.env.APP2049_MANAGEMENT_TOKEN = token;
  try {
    expect((await GET(request('/api/app/members', 'GET', undefined, 'wrong'))).status).toBe(401);
    expect((await POST(request('/api/app/members', 'POST', { label: 'Research' }, token, 'http://evil.example'))).status).toBe(403);
    expect((await POST(request('/api/app/members', 'POST', { label: '' }))).status).toBe(400);
    const created = await POST(request('/api/app/members', 'POST', { label: 'Research' }));
    expect(created.status).toBe(201);
    const { member } = await created.json() as { member: { id: string; label: string } };
    expect(member.label).toBe('Research');
    const context = { params: Promise.resolve({ memberId: member.id }) };
    const listed = await GET(request('/api/app/members'));
    const members = (await listed.json() as { members: Array<{ member: { id: string }; purchases?: unknown }> }).members;
    expect(members).toHaveLength(2);
    expect(members.find(item => item.member.id === member.id)).not.toHaveProperty('purchases');
    expect((await GETMember(request(`/api/app/members/${member.id}`), context)).status).toBe(200);
    expect((await PUTMember(request(`/api/app/members/${member.id}`, 'PUT', { label: 'Buyer' }), context)).status).toBe(200);
    expect((await PUTConnection(request(`/api/app/members/${member.id}/connection`, 'PUT', { enabled: true }), context)).status).toBe(200);
    expect((await PUTGrant(request(`/api/app/members/${member.id}/grant`, 'PUT', {
      action: 'create', totalLimit: '200000', singleLimit: '200000', expiresAt: now + 3_600_000,
    }), context)).status).toBe(200);
    const detail = await GETMember(request(`/api/app/members/${member.id}`), context);
    expect(JSON.stringify(await detail.json())).not.toContain(readConnection(app.directory, member.id).token);
    const revoked = await DELETE(request(`/api/app/members/${member.id}`, 'DELETE'), context);
    expect(revoked.status).toBe(200);
    expect((await revoked.json() as { member: { status: string } }).member.status).toBe('REVOKED');
    expect((await PUTConnection(request(`/api/app/members/${member.id}/connection`, 'PUT', { enabled: true }), context)).status).toBe(409);
  } finally { app.close(); }
});
