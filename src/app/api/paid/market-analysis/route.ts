import {
  paidMarketSnapshotResponse,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RECOVERY_HEADER,
} from '../../../../modules/paid-market-api/paid-market-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].length !== 1 || query.get('asset') !== 'SOL') {
    return Response.json({ error: 'Only asset=SOL is supported' }, { status: 400 });
  }
  return paidMarketSnapshotResponse({ asset: 'SOL', resource: 'analysis' },
    request.headers.get(PAYMENT_SIGNATURE_HEADER) ?? undefined,
    request.headers.get(PAYMENT_RECOVERY_HEADER) === '1');
}
