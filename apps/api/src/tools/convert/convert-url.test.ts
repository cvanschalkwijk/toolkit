import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { convertUrlTool } from './convert-url'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('convertUrlTool', () => {
  test('POSTs JSON {url, engine, format} to /convert/url', async () => {
    let captured: { url?: string; body?: string } = {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, body: init?.body as string }
      return new Response(
        JSON.stringify({
          markdown: 'Hello World',
          engine_used: 'markitdown',
          format: 'markdown',
          source: { url: 'https://example.com/article' },
          duration_ms: 321,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await convertUrlTool.execute({
      url: 'https://example.com/article',
      engine: 'markitdown',
      format: 'markdown',
    })
    expect(out.markdown).toBe('Hello World')
    expect(captured.url).toBe('http://sidecar.test:8000/convert/url')
    expect(JSON.parse(captured.body as string)).toEqual({
      url: 'https://example.com/article',
      engine: 'markitdown',
      format: 'markdown',
    })
  })

  test('rejects non-URL strings at the schema boundary', async () => {
    // Zod validation happens inside the input schema.
    expect(() => convertUrlTool.input.parse({ url: 'not a url' })).toThrow()
    expect(() => convertUrlTool.input.parse({ url: 'https://example.com' })).not.toThrow()
  })
})
