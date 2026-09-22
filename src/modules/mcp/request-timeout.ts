const READ_REQUEST_TIMEOUT_MS = 20_000;
export const PURCHASE_REQUEST_TIMEOUT_MS = 180_000;

export function appRequestTimeout(path: string) {
  return path === '/api/agent/purchases' ? PURCHASE_REQUEST_TIMEOUT_MS : READ_REQUEST_TIMEOUT_MS;
}
