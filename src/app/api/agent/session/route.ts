import { appRuntime } from '../../../../modules/app/app-runtime';
import { McpSessionEventSchema } from '../../../../modules/mcp/session';
import { smallJson } from '../../../../modules/http/local-request';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const app = appRuntime();
  try { app.authenticateAgent(request); }
  catch { return Response.json({ code: 'AGENT_UNAUTHORIZED' }, { status: 401 }); }
  try {
    const event = McpSessionEventSchema.parse(await smallJson(request));
    app.observeMcpSession(request, event);
    return Response.json({ accepted: true }, { headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ code: 'MCP_SESSION_REJECTED' }, { status: 409 }); }
}
