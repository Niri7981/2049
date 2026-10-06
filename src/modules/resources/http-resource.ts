import { z } from 'zod';
import { address } from '@solana/kit';
import { PositiveAtomicAmountSchema } from '../authority/atomic-money';

export const SolanaPublicKeySchema = z.string().refine(value => { try { address(value); return true; } catch { return false; } });
export const HttpMethodSchema = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const text = z.string().max(2048).refine(value => !/[\r\n\0]/.test(value));
/** Only declarative resource facts: no merchant name, wallet source or payment permission. */
export const HttpResourceRequestSchema = z.object({
  url: z.string().max(2048), method: HttpMethodSchema,
  access: z.enum(['https', 'test_loopback']),
  headers: z.object({ accept: text.optional(), 'content-type': text.optional() }).strict(),
  body: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 16_384).optional(),
}).strict().superRefine((request, ctx) => {
  try {
    const url = new URL(request.url);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const numericHost = /^\d+(?:\.\d+)*$/.test(url.hostname) || url.hostname.startsWith('[');
    const privateHost = loopback || numericHost || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || !url.hostname.includes('.');
    if (url.href !== request.url || url.username || url.password || url.hash || /[\s\0]/.test(request.url)
      || (request.access === 'https' ? url.protocol !== 'https:' || privateHost : !loopback || !['http:', 'https:'].includes(url.protocol))
      || (['GET', 'HEAD'].includes(request.method) && request.body !== undefined)) throw new Error('Invalid request');
  } catch { ctx.addIssue({ code: 'custom', message: 'INVALID_RESOURCE_REQUEST' }); }
});
export type HttpResourceRequest = z.infer<typeof HttpResourceRequestSchema>;
const headerName = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/).refine(value =>
  !['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'host', 'content-length', 'content-type', 'accept', 'origin', 'referer',
    'connection', 'transfer-encoding', 'x-http-method-override', 'x-method-override',
    'payment-signature', 'payment-required', 'payment-response'].includes(value.toLowerCase()) && !/^(sec-|proxy-)/i.test(value));
const headerValue = z.string().min(1).max(240).refine(value => !/[\r\n\0]/.test(value));

/** Server-approved capabilities, never inferred from a merchant name or a 402. */
export const DeliveryRecoveryCapabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('idempotent_replay') }).strict(),
  z.object({ kind: z.literal('cached_replay'), replayHeader: z.object({ name: headerName, value: headerValue }).strict() }).strict(),
  z.object({ kind: z.literal('payment_identifier'), request: HttpResourceRequestSchema,
    identifier: z.enum(['transaction', 'purchase_id']), location: z.enum(['query', 'header']),
    name: headerName }).strict().superRefine((capability, ctx) => {
      if (capability.request.method !== 'GET' || capability.request.body !== undefined) ctx.addIssue({ code: 'custom', message: 'RECOVERY_REQUIRES_READ_ONLY_REQUEST' });
    }),
]);
export type DeliveryRecoveryCapability = z.infer<typeof DeliveryRecoveryCapabilitySchema>;

export const X402ResourceSchema = z.object({
  resourceId: z.string().min(1).max(200), providerId: z.string().min(1).max(200),
  request: HttpResourceRequestSchema, deliveryRecovery: DeliveryRecoveryCapabilitySchema.optional(),
  network: z.templateLiteral(['solana:', z.string().min(1)]),
  mint: SolanaPublicKeySchema, decimals: z.literal(6), recipient: SolanaPublicKeySchema,
  amount: z.string().refine(value => PositiveAtomicAmountSchema.safeParse(value).success).optional(),
}).strict();
export type X402Resource = z.infer<typeof X402ResourceSchema>;

// Protocol DTOs remain independent of the backend SDK client and signing modules.
export const X402ChallengeSchema = z.object({
  x402Version: z.literal(2), error: z.string().optional(),
  resource: z.object({ url: z.string().min(1).max(2048), description: z.string().optional(), mimeType: z.string().optional(),
    serviceName: z.string().optional(), tags: z.array(z.string()).optional(), iconUrl: z.string().optional() }).strict(),
  accepts: z.array(z.object({ scheme: z.string(), network: z.templateLiteral([z.string().min(1), ':', z.string().min(1)]),
    amount: z.string(), asset: z.string(), payTo: z.string(), maxTimeoutSeconds: z.number(), extra: z.record(z.string(), z.json()) }).strict()).min(1).max(8),
  extensions: z.record(z.string(), z.json()).optional(),
}).strict();
export type X402Challenge = z.infer<typeof X402ChallengeSchema>;
