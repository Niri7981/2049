import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export type AgentRead = (operation: 'status' | 'quote') => Promise<unknown>;
export type AgentPurchaseRequest = (input: { requestId: string; resourceId: string; reason: string }) => Promise<unknown>;

/** Official MCP SDK owns negotiation, schemas and transport; Yosh only maps tools. */
export function createAgentServer(read: AgentRead, requestPurchase: AgentPurchaseRequest = async () => { throw new Error('PURCHASE_REQUEST_UNAVAILABLE'); }) {
  const server = new McpServer({ name: 'Yosh', version: '0.1.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  for (const [name, operation, description] of [
    ['get_spending_status', 'status', 'Read the Yosh wallet address and shared spending budget. Does not pay.'],
    ['get_market_quote', 'quote', 'Read current x402 quotes for registered SOL demo resources. Does not authorize or pay.'],
  ] as const) {
    server.registerTool(name, { description, inputSchema: {}, annotations }, async () => {
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await read(operation)) }] }; }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'APP_UNAVAILABLE: 请启动 Yosh 并启用 Agent 连接；请求未付款。' }] }; }
    });
  }
  server.registerTool('request_purchase', {
    description: 'Request a registered SOL paid resource. The local Yosh backend obtains a fresh x402 quote, applies SpendGrant and budget policy, and may execute an approved Devnet purchase. The Agent cannot provide payment terms or signing data.',
    inputSchema: {
      requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).describe('Stable idempotency key for this purchase request'),
      resourceId: z.string().min(1).max(200).describe('Registered paid resource; the Agent cannot provide an amount'),
      reason: z.string().trim().min(1).max(240).describe('Short user-facing reason for requesting this data'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async input => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await requestPurchase(input)) }] }; }
    catch { return { isError: true, content: [{ type: 'text' as const, text: 'PURCHASE_REQUEST_FAILED: Yosh 未创建付款；请检查 Agent 授权、报价和策略。' }] }; }
  });
  return server;
}
