/**
 * HTTP adapter tests. Exercises the adapter by mounting the built-in `ping`
 * tool on a fresh OpenAPIHono instance and probing the resulting route.
 * No network, no Python sidecar — pure TS.
 */

import { describe, expect, test } from 'bun:test'
import { OpenAPIHono } from '@hono/zod-openapi'
import { toStored } from '../lib/tool'
import { pingTool } from '../tools/ping/ping'
import { mountHttp } from './http'

const storedPing = toStored(pingTool)

describe('mountHttp', () => {
  test('registers a tool as an OpenAPI-documented POST route', async () => {
    const app = new OpenAPIHono()
    mountHttp(app, [storedPing])
    const res = await app.request('/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reply: string; timestamp: string }
    expect(body.reply).toBe('pong: hi')
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('returns 400 with a validation error on missing required field', async () => {
    const app = new OpenAPIHono()
    mountHttp(app, [storedPing])
    const res = await app.request('/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 'field' }),
    })
    expect(res.status).toBe(400)
    // @hono/zod-openapi produces its own default 400 shape; we don't try to
    // dictate it — we just verify the response is a structured error payload.
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('returns 400 on malformed JSON body', async () => {
    const app = new OpenAPIHono()
    mountHttp(app, [storedPing])
    const res = await app.request('/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  test('includes the tool in the generated OpenAPI spec', async () => {
    const app = new OpenAPIHono()
    mountHttp(app, [storedPing])
    app.doc('/openapi.json', { openapi: '3.0.0', info: { title: 't', version: '0' } })
    const res = await app.request('/openapi.json')
    const spec = (await res.json()) as { paths: Record<string, unknown>; tags?: unknown[] }
    expect(spec.paths).toHaveProperty('/ping')
    expect(JSON.stringify(spec)).toContain('meta')
  })
})
