import { x402Client, x402HTTPClient } from '@x402/core/client';
import { PaymentRequiredV2Schema, PaymentPayloadV2Schema } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';

const MAX_PAYMENT_HEADER_BYTES = 16_384;
const protocol = new x402HTTPClient(new x402Client());

function boundedHeader(value: string | null, name: string) {
  if (!value) throw new Error(`Missing ${name}`);
  if (value.length > MAX_PAYMENT_HEADER_BYTES) throw new Error(`${name} is too large`);
  return value;
}

/** Decode wire headers through the official x402 HTTP adapter, then validate the result. */
export function readPaymentRequiredHeader(encoded: string): PaymentRequired {
  const value = boundedHeader(encoded, 'PAYMENT-REQUIRED');
  const decoded = protocol.getPaymentRequiredResponse(name => name === 'PAYMENT-REQUIRED' ? value : null);
  return PaymentRequiredV2Schema.parse(decoded) as PaymentRequired;
}

export function paymentSignatureHeaders(payload: PaymentPayload): Record<string, string> {
  PaymentPayloadV2Schema.parse(payload);
  return protocol.encodePaymentSignatureHeader(payload);
}

export function readSettlementResponse(response: Response): SettleResponse {
  boundedHeader(response.headers.get('PAYMENT-RESPONSE'), 'PAYMENT-RESPONSE');
  return protocol.getPaymentSettleResponse(name => response.headers.get(name));
}
