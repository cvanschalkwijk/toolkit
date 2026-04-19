/**
 * Hono app with OpenAPI spec, Swagger UI at /, and a /health endpoint.
 * Tools are mounted by the adapters in src/adapters (Phase 2+).
 */

import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { mountHttp } from './adapters/http'
import { mountMcp } from './adapters/mcp'
import { tools } from './tools/registry'

const app = new OpenAPIHono()

// --- Health ---
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['meta'],
  summary: 'Liveness check',
  responses: {
    200: {
      description: 'Service is alive',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok'), version: z.string() }),
        },
      },
    },
  },
})

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const, version: '0.1.0' }))

// --- OpenAPI spec + Swagger UI ---
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'toolkit',
    version: '0.1.0',
    description:
      'HTTP + MCP utility API for LLM-efficient document tooling. The same tools are available over MCP at /mcp (SSE transport).',
  },
  tags: [
    { name: 'meta', description: 'Health + service info' },
    { name: 'convert', description: 'Document → LLM-friendly markdown' },
    { name: 'chunk', description: 'Context-aware text chunking' },
    { name: 'sanitize', description: 'PII detection + redaction' },
    { name: 'extract', description: 'Structured extraction via LLM + schema' },
  ],
})

app.get('/', swaggerUI({ url: '/openapi.json' }))

// --- Tools: mount on both HTTP and MCP surfaces ---
mountHttp(app, tools)
mountMcp(app, tools)

export default app
