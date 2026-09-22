import { expect, it } from 'vitest';
import { appRequestTimeout, PURCHASE_REQUEST_TIMEOUT_MS } from '../../src/modules/mcp/request-timeout';

it('allows a real purchase to run for 180 seconds while keeping reads bounded', () => {
  expect(PURCHASE_REQUEST_TIMEOUT_MS).toBe(180_000);
  expect(appRequestTimeout('/api/agent/purchases')).toBe(180_000);
  expect(appRequestTimeout('/api/agent?operation=status')).toBe(20_000);
});
