import { z } from '@hono/zod-openapi'
import { defineTool } from '../../lib/tool'

export const pingTool = defineTool({
  name: 'ping',
  description:
    'Simple liveness + echo tool. Returns the message you sent back with a server timestamp. Useful as a framework-health probe that exercises both the HTTP and MCP surfaces end-to-end.',
  category: 'meta',
  http: { method: 'post', path: '/ping' },
  input: z
    .object({
      message: z.string().describe('Any string. Will be echoed back in the reply.'),
    })
    .openapi('PingInput'),
  output: z
    .object({
      reply: z.string().describe('The message prefixed with "pong: ".'),
      timestamp: z.string().describe('ISO-8601 server timestamp at the moment the call handled.'),
    })
    .openapi('PingOutput'),
  execute: async ({ message }) => ({
    reply: `pong: ${message}`,
    timestamp: new Date().toISOString(),
  }),
})
