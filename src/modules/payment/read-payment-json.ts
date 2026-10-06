/** Bound untrusted RPC/facilitator bytes before JSON decoding. */
export async function readPaymentJson(response: Response, maxBytes = 256 * 1024): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PAYMENT_RESPONSE_INVALID');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('PAYMENT_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
