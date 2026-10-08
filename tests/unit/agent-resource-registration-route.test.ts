import { beforeEach, expect, it, vi } from 'vitest';
import { ResourceRegistryError } from '../../src/modules/resources/runtime-resource-registry';
import { AgentResourceRegistrationInput } from '../../src/modules/resources/agent-resource-registration';
const state = vi.hoisted(() => ({ authenticate: vi.fn(), register: vi.fn() }));
vi.mock('@/modules/app/app-runtime', () => ({ appRuntime: () => ({ authenticateAgent: state.authenticate, registerAgentResource: state.register }) }));
import { POST } from '../../src/app/api/agent/resources/route';
const principal = { cardMemberId: 'member' };
const input = { discoveryId: '11111111-1111-4111-8111-111111111111', resourceId: 'example', providerId: 'example.com', displayName: 'Example' };
const request = (body: unknown) => new Request('http://127.0.0.1:3049/api/agent/resources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.authenticate.mockReturnValue(principal); });
it('requires authenticated Agent before reading or writing registration input', async () => {
  state.authenticate.mockImplementation(() => { throw new Error('revoked'); });
  expect((await POST(request(input))).status).toBe(401); expect(state.register).not.toHaveBeenCalled();
});
it('passes only creation to the shared runtime and preserves explicit no-authority result', async () => {
  state.register.mockReturnValue({ resourceId: 'example', registrationStatus: 'REGISTERED', spendingAuthorityCreated: false, paymentSent: false });
  const response = await POST(request(input)); expect(response.status).toBe(201);
  expect(state.register).toHaveBeenCalledWith(input, principal);
  expect(await response.json()).toMatchObject({ registrationStatus: 'REGISTERED', spendingAuthorityCreated: false, paymentSent: false });
});
it('rejects injected permissions with a stable sanitized error', async () => {
  state.register.mockImplementation(raw => AgentResourceRegistrationInput.parse(raw));
  const response = await POST(request({ ...input, approved: true, maximumAmount: '999999' }));
  expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'RESOURCE_REGISTRATION_INPUT_INVALID' });
});
it('maps duplicate and expired discoveries without exposing internal exceptions', async () => {
  state.register.mockImplementation(() => { throw new ResourceRegistryError('RESOURCE_DISCOVERY_EXPIRED'); });
  expect(await (await POST(request(input))).json()).toMatchObject({ code: 'RESOURCE_DISCOVERY_EXPIRED' });
  state.register.mockImplementation(() => { throw new Error('secret upstream payload'); });
  expect(JSON.stringify(await (await POST(request(input))).json())).not.toContain('secret');
});
