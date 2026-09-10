import { MarketSnapshotOutputSchema } from './resource-schema';

/** Bound streamed bytes, not just Content-Length, before parsing untrusted JSON. */
export async function readMarketSnapshot(response: Response) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Expected JSON');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing market data');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) throw new Error('Market data too large');
      chunks.push(value);
    }
    return MarketSnapshotOutputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
