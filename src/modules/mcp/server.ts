import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type AgentRead = (operation: 'status' | 'quote') => Promise<unknown>;

/** Official MCP SDK owns negotiation, schemas and transport; 2049 only maps tools. */
export function createAgentServer(read: AgentRead) {
  const server = new McpServer({ name: '2049', version: '0.1.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  for (const [name, operation, description] of [
    ['get_spending_status', 'status', 'Read the 2049 wallet address and shared spending budget. Does not pay.'],
    ['get_market_quote', 'quote', 'Read a real x402 quote for the fixed SOL demo snapshot on Solana Devnet. Does not authorize or pay.'],
  ] as const) {
    server.registerTool(name, { description, inputSchema: {}, annotations }, async () => {
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await read(operation)) }] }; }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'APP_UNAVAILABLE: 请启动 2049 并启用 Agent 连接；请求未付款。' }] }; }
    });
  }
  return server;
}
