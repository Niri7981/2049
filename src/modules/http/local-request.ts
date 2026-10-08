import { MAX_LOCAL_REQUEST_BYTES } from './request-size-limits';
export class LocalRequestError extends Error {}
export class RequestBodyError extends Error {}

/** Browser origins cannot authorize cross-site requests to the local service. */
export function requireLocalRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // Next normalizes Request.url to localhost; validate the actual Host separately.
  let address: URL;
  try { address = new URL(`http://${host ?? url.host}`); }
  catch { throw new LocalRequestError("只允许本机访问。"); }
  const loopback = (value: URL) =>
    value.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname);
  if (
    !loopback(url) ||
    !loopback(address) ||
    address.port !== url.port ||
    address.host !== (host ?? url.host)
  )
    throw new LocalRequestError("只允许本机访问。");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new LocalRequestError("不允许跨站请求。");
  if (
    mutation &&
    (request.headers.get("origin") !== address.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    throw new LocalRequestError("需要同源 JSON 请求。");
}

/** Return the validated socket origin; Next may normalize Request.url to localhost. */
export function localRequestOrigin(request: Request) {
  requireLocalRequest(request);
  const url = new URL(request.url);
  return new URL(`http://${request.headers.get("host") ?? url.host}`).origin;
}
export async function smallJson(request: Request, maximumBytes = MAX_LOCAL_REQUEST_BYTES) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError("缺少请求内容。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) throw new RequestBodyError("任务内容过长。");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new RequestBodyError("请求内容不是有效 JSON。"); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
