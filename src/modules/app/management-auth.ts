import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { LocalRequestError, RequestBodyError, requireLocalRequest } from '../http/local-request';
import { DataDirectoryInUseError } from './data-directory-owner';

export class ManagementApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly safeMessage: string) { super(code); }
}

export function requireManagementRequest(request: Request, mutation = false) {
  requireLocalRequest(request, mutation);
  const expected = process.env.APP2049_MANAGEMENT_TOKEN;
  const provided = request.headers.get('authorization');
  if (!expected || expected.length < 32 || !provided?.startsWith('Bearer ')) throw new ManagementApiError('UNAUTHORIZED', 401, '未授权的管理请求。');
  const actual = provided.slice(7);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ManagementApiError('UNAUTHORIZED', 401, '未授权的管理请求。');
}

export function managementError(error: unknown) {
  let failure: ManagementApiError;
  if (error instanceof ManagementApiError) failure = error;
  else if (error instanceof LocalRequestError) failure = new ManagementApiError('LOCAL_REQUEST_FORBIDDEN', 403, '请求来源不被允许。');
  else if (error instanceof RequestBodyError || error instanceof ZodError)
    failure = new ManagementApiError('INVALID_REQUEST', 400, '请求内容无效。');
  else if (error instanceof DataDirectoryInUseError)
    failure = new ManagementApiError('DATA_DIRECTORY_IN_USE', 503, '2049 数据已由另一服务使用。');
  else failure = new ManagementApiError('INTERNAL_ERROR', 500, '本地服务暂时无法完成请求。');
  return Response.json({ code: failure.code, error: failure.safeMessage }, { status: failure.status, headers: { 'cache-control': 'no-store' } });
}
