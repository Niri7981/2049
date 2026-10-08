import { MarketSnapshotOutputSchema } from './resource-schema';
import { ResourceDeliveryPolicySchema, type ResourceDeliveryPolicy } from './http-resource';

export const DEFAULT_RESOURCE_DELIVERY_POLICY: ResourceDeliveryPolicy = {
  format: 'json', mimeTypes: ['application/json'], maxBytes: 16_384,
};

/** Read only declared response formats with a streamed byte cap. */
export async function readBoundedResourceDelivery(response: Response, policy: ResourceDeliveryPolicy = DEFAULT_RESOURCE_DELIVERY_POLICY): Promise<unknown> {
  const selected = ResourceDeliveryPolicySchema.parse(policy);
  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!mime || !selected.mimeTypes.includes(mime)) throw new Error('Unexpected resource MIME type');
  if (selected.format === 'json' && mime !== 'application/json' && !mime.endsWith('+json')) throw new Error('Expected JSON');
  if (selected.format === 'text' && !mime.startsWith('text/')) throw new Error('Expected text');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing resource data');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > selected.maxBytes) throw new Error('Resource data too large');
      chunks.push(value);
    }
    const data = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return selected.format === 'json' ? JSON.parse(data) as unknown : data;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Bound streamed bytes, not just Content-Length, before parsing untrusted JSON. */
export async function readBoundedResourceJson(response: Response): Promise<unknown> {
  return readBoundedResourceDelivery(response);
}

export async function readMarketSnapshot(response: Response) {
  return MarketSnapshotOutputSchema.parse(await readBoundedResourceJson(response));
}
