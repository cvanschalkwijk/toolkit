/**
 * MCP adapter tests. We bind the Hono app to a real ephemeral HTTP port
 * (Bun.serve) and drive it with the MCP SDK's official client + Streamable
 * HTTP client transport. That way we exercise the transport end-to-end
 * instead of trying to drain an SSE stream through Hono's in-process
 * request helper (which doesn't handle chunked stream bodies well).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { toStored } from '../lib/tool'
import { pingTool } from '../tools/ping/ping'
import { mountMcp } from './mcp'

const storedPing = toStored(pingTool)

let server: ReturnType<typeof Bun.serve> | undefined
let url: URL | undefined

beforeEach(() => {
  const app = new OpenAPIHono()
  mountMcp(app, [storedPing])
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch })
  url = new URL(`http://127.0.0.1:${server.port}/mcp`)
})

afterEach(async () => {
  await server?.stop()
  server = undefined
  url = undefined
})

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!url) throw new Error('server not started')
  const transport = new StreamableHTTPClientTransport(url)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

describe('mountMcp', () => {
  test('initialize handshake succeeds', async () => {
    await withClient(async (client) => {
      const info = client.getServerVersion()
      expect(info?.name).toBe('toolkit')
      expect(info?.version).toBe('0.1.0')
    })
  })

  test('tools/list surfaces the registered tool', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('ping')
      const ping = tools.find((t) => t.name === 'ping')
      expect(ping?.description).toContain('echo')
      expect(ping?.inputSchema).toBeDefined()
    })
  })

  test('tools/call invokes the registered tool and returns structured output', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'ping',
        arguments: { message: 'hello' },
      })
      expect(result.isError).toBeFalsy()
      const content = result.content as Array<{ type: string; text?: string }>
      const text = content[0]?.text ?? ''
      expect(text).toContain('pong: hello')
      const parsed = JSON.parse(text) as { reply: string; timestamp: string }
      expect(parsed.reply).toBe('pong: hello')
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  test('tools/call flags invalid arguments as errors', async () => {
    // MCP may report invalid args as either a thrown JSON-RPC error or a
    // successful reply with `isError: true`. Accept either — both are
    // legitimate error signals for a client.
    await withClient(async (client) => {
      try {
        const result = await client.callTool({
          name: 'ping',
          arguments: { not_the_right_field: 123 },
        })
        expect(result.isError).toBe(true)
      } catch (e) {
        expect((e as Error).message).toMatch(/Invalid arguments|validation|required/i)
      }
    })
  })

  test('tools/call flags unknown tool names as errors', async () => {
    await withClient(async (client) => {
      // The SDK may surface "unknown tool" either as a protocol-level throw
      // or as a successful reply with `isError: true`. Accept either —
      // what matters is the caller can tell something went wrong.
      try {
        const result = await client.callTool({ name: 'does_not_exist', arguments: {} })
        expect(result.isError).toBe(true)
      } catch (e) {
        expect((e as Error).message).toMatch(/not found|unknown|invalid/i)
      }
    })
  })
})
