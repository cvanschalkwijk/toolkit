/**
 * HTTP adapter: mounts every tool in `tools[]` as an OpenAPI route on the
 * Hono app. `@hono/zod-openapi` takes care of schema validation and spec
 * generation from the tool's zod schemas.
 */

import type { OpenAPIHono } from '@hono/zod-openapi'
import { createRoute, z } from '@hono/zod-openapi'
import type { StoredTool } from '../lib/tool'

const errorSchema = z
  .object({
    error: z.object({
      message: z.string(),
      code: z.string().optional(),
    }),
  })
  .openapi('Error')

export function mountHttp(app: OpenAPIHono, tools: StoredTool[]): void {
  for (const tool of tools) {
    const summary = (tool.description.split('\n')[0] ?? tool.description).slice(0, 100)

    // GETs have no body; anything else takes JSON.
    const hasBody = tool.http.method !== 'get'

    const route = createRoute({
      method: tool.http.method,
      path: tool.http.path,
      tags: [tool.category],
      summary,
      description: tool.description,
      ...(hasBody
        ? {
            request: {
              body: {
                content: { 'application/json': { schema: tool.input } },
                required: true,
              },
            },
          }
        : {}),
      responses: {
        200: {
          description: 'Success',
          content: { 'application/json': { schema: tool.output } },
        },
        400: {
          description: 'Invalid input',
          content: { 'application/json': { schema: errorSchema } },
        },
        500: {
          description: 'Internal error',
          content: { 'application/json': { schema: errorSchema } },
        },
      },
    })

    app.openapi(
      // biome-ignore lint/suspicious/noExplicitAny: Hono's per-route typing can't express heterogeneous iteration
      route as any,
      // biome-ignore lint/suspicious/noExplicitAny: see above — context type is route-derived
      (async (c: any) => {
        try {
          const raw = hasBody ? await c.req.json().catch(() => ({})) : {}
          const output = await tool.invoke(raw)
          return c.json(output, 200)
        } catch (e) {
          if (e instanceof z.ZodError) {
            return c.json(
              {
                error: {
                  message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
                  code: 'validation',
                },
              },
              400,
            )
          }
          const msg = e instanceof Error ? e.message : 'unknown error'
          console.error(`tool "${tool.name}" failed:`, e)
          return c.json({ error: { message: msg } }, 500)
        }
      }) as never,
    )
  }
}
