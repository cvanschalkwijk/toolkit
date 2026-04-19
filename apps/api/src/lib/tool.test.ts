import { describe, expect, test } from 'bun:test'
import { z } from '@hono/zod-openapi'
import { defineTool } from './tool'

describe('defineTool', () => {
  test('preserves the tool object and its types', async () => {
    const tool = defineTool({
      name: 'echo',
      description: 'echoes what you send',
      category: 'test',
      http: { method: 'post', path: '/echo' },
      input: z.object({ value: z.string() }),
      output: z.object({ value: z.string() }),
      execute: async ({ value }) => ({ value }),
    })

    expect(tool.name).toBe('echo')
    expect(tool.http.method).toBe('post')
    const result = await tool.execute({ value: 'hi' })
    expect(result.value).toBe('hi')
  })

  test('input must be a z.object (shape accessible for MCP adapter)', () => {
    const tool = defineTool({
      name: 'test',
      description: 'test',
      category: 'test',
      http: { method: 'post', path: '/test' },
      input: z.object({ a: z.string(), b: z.number() }),
      output: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    expect(Object.keys(tool.input.shape).sort()).toEqual(['a', 'b'])
  })
})
