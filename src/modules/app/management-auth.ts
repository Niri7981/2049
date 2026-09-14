import { timingSafeEqual } from 'node:crypto';
import { requireLocalRequest } from '../demo/local-request';

export function requireManagementRequest(request: Request, mutation = false) {
  requireLocalRequest(request, mutation);
  const expected = process.env.APP2049_MANAGEMENT_TOKEN;
  const provided = request.headers.get('authorization');
  if (!expected || expected.length < 32 || !provided?.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  const actual = provided.slice(7);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('UNAUTHORIZED');
}

export function managementError(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return Response.json({ error: '未授权的管理请求。' }, { status: 401 });
  const message = error instanceof Error ? error.message : '请求失败。';
  return Response.json({ error: message }, { status: 400 });
}
