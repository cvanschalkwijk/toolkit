/**
 * MCP adapter: mounts every tool in `tools[]` on an McpServer and exposes
 * that server over HTTP via the MCP Streamable-HTTP transport at /mcp.
 *
 * Transport mode: **stateless**. The SDK requires a fresh transport per
 * HTTP request in stateless mode (it throws if you try to reuse one), so
 * we build a server + transport pair on each call. Tool registration is a
 * cheap in-memory map mutation, and per-request servers also cleanly
 * isolate any logging/state between concurrent callers.
 */

import type { OpenAPIHono } from '@hono/zod-openapi'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { StoredTool } from '../lib/tool'

function registerTools(server: McpServer, tools: StoredTool[]): void {
  for (const tool of tools) {
    // McpServer.tool expects ZodRawShape (z.object's .shape) not the wrapping object.
    const shape = tool.input.shape

    server.tool(tool.name, tool.description, shape, async (args: unknown) => {
      try {
        const output = await tool.invoke(args)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        }
      }
    })
  }
}

export function mountMcp(app: OpenAPIHono, tools: StoredTool[]): void {
  app.all('/mcp', async (c) => {
    const server = new McpServer({ name: 'toolkit', version: '0.1.0' })
    registerTools(server, tools)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Reply with plain JSON instead of opening an SSE stream. This tool
      // server is stateless and every response fits in one JSON message, so
      // there's no reason to stream. Clients still send `Accept: text/event-stream`
      // but the server is permitted to answer with application/json per the
      // Streamable HTTP spec.
      enableJsonResponse: true,
    })
    try {
      await server.connect(transport)
      return await transport.handleRequest(c.req.raw)
    } finally {
      await server.close().catch(() => {})
    }
  })
}
