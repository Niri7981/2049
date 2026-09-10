/** Browser origins cannot authorize cross-site requests to the local wallet demo. */
export function requireLocalRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // Next normalizes Request.url to localhost; validate the actual Host separately.
  const address = new URL(`http://${host ?? url.host}`);
  const loopback = (value: URL) =>
    value.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname);
  if (
    !loopback(url) ||
    !loopback(address) ||
    address.port !== url.port ||
    address.host !== (host ?? url.host)
  )
    throw new Error("只允许本机访问。");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new Error("不允许跨站请求。");
  if (
    mutation &&
    (request.headers.get("origin") !== address.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    throw new Error("需要同源 JSON 请求。");
}
export async function smallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("缺少请求内容。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new Error("任务内容过长。");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
