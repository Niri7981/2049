import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  spawn: vi.fn(),
  ledgerConstructed: vi.fn(),
  parseInput: vi.fn(),
  storeConstructed: vi.fn(),
  storeStart: vi.fn(),
  setPid: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: state.spawn }));
vi.mock('@/modules/demo/demo-store', () => ({
  DemoInput: { parse: state.parseInput },
  DemoStore: class {
    constructor() { state.storeConstructed(); }
    start(input: unknown) { return state.storeStart(input); }
    setPid(...args: unknown[]) { state.setPid(...args); }
    close() { state.close(); }
  },
}));
vi.mock('@/modules/purchases/purchase-ledger', () => ({
  PurchaseLedger: class { constructor() { state.ledgerConstructed(); } },
}));
vi.mock('@/modules/demo/local-request', async () => await import('../../src/modules/demo/local-request'));
vi.mock('@/modules/app/product-mode', async () => await import('../../src/modules/app/product-mode'));

import { GET, POST } from '../../src/app/api/demo/tasks/route';

function postRequest() {
  return new Request('http://127.0.0.1:3049/api/demo/tasks', {
    method: 'POST', headers: { host: '127.0.0.1:3049', origin: 'http://127.0.0.1:3049', 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'legacy-task-1', task: 'Analyze SOL' }),
  });
}
function getRequest() {
  return new Request('http://127.0.0.1:3049/api/demo/tasks', { headers: { host: '127.0.0.1:3049' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.parseInput.mockImplementation(input => input);
  state.storeStart.mockReturnValue({ started: true, token: 'isolated-test-token' });
  const child = Object.assign(new EventEmitter(), { pid: 42, unref: vi.fn() });
  state.spawn.mockReturnValue(child);
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', '');
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', '');
  vi.stubEnv('OPENAI_API_KEY', 'test-model-key');
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['default test environment', 'test', '', ''],
  ['standalone development without explicit opt-in', 'development', '', ''],
  ['Electron development runtime without explicit opt-in', 'development', 'product-management-token', ''],
  ['standalone production Next runtime', 'production', '', ''],
  ['packaged Electron runtime', 'production', 'product-management-token', ''],
  ['production even with the development opt-in set', 'production', '', '1'],
] as const)('fails closed in %s without starting task or payment work', async (_name, nodeEnv, managementToken, optIn) => {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', managementToken);
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', optIn);

  const response = await POST(postRequest());

  expect(response.status).toBe(404);
  const readResponse = await GET(getRequest());
  expect(readResponse.status).toBe(404);
  expect(state.spawn).not.toHaveBeenCalled();
  expect(state.storeConstructed).not.toHaveBeenCalled();
  expect(state.ledgerConstructed).not.toHaveBeenCalled();
  expect(state.storeStart).not.toHaveBeenCalled();
  expect(state.parseInput).not.toHaveBeenCalled();
});

it('allows the old task worker only with explicit opt-in in isolated development', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', 'electron-development-token');
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', '1');

  const response = await POST(postRequest());

  expect(response.status).toBe(202);
  expect(state.storeConstructed).toHaveBeenCalledOnce();
  expect(state.storeStart).toHaveBeenCalledWith({ taskId: 'legacy-task-1', task: 'Analyze SOL' });
  expect(state.spawn).toHaveBeenCalledOnce();
  expect(state.spawn.mock.calls[0]?.[1]).toContain('scripts/task-worker.ts');
  expect(state.spawn.mock.calls[0]?.[1]).toContain('legacy-task-1');
  expect(state.setPid).toHaveBeenCalledWith('legacy-task-1', 'isolated-test-token', 42);
});
