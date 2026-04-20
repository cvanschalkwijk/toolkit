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
      fetcher: 'direct',
    })
    expect(out.markdown).toBe('Hello World')
    expect(captured.url).toBe('http://sidecar.test:8000/convert/url')
    expect(JSON.parse(captured.body as string)).toEqual({
      url: 'https://example.com/article',
      engine: 'markitdown',
      format: 'markdown',
      fetcher: 'direct',
    })
  })

  test('forwards fetcher="stealth" to the sidecar', async () => {
    let body: string | undefined
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      body = init?.body as string
      return new Response(
        JSON.stringify({
          markdown: 'Post-challenge body',
          engine_used: 'markitdown',
          fetcher_used: 'stealth',
          format: 'markdown',
          source: { url: 'https://cf-walled.example.com' },
          duration_ms: 4213,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await convertUrlTool.execute({
      url: 'https://cf-walled.example.com',
      engine: 'markitdown',
      format: 'markdown',
      fetcher: 'stealth',
    })
    expect(out.fetcher_used).toBe('stealth')
    expect(JSON.parse(body as string).fetcher).toBe('stealth')
  })

  test('defaults fetcher to "direct"', () => {
    const parsed = convertUrlTool.input.parse({ url: 'https://example.com' })
    expect(parsed.fetcher).toBe('direct')
    expect(parsed.engine).toBe('auto')
    expect(parsed.format).toBe('markdown')
  })

  test('rejects non-URL strings at the schema boundary', async () => {
    // Zod validation happens inside the input schema.
    expect(() => convertUrlTool.input.parse({ url: 'not a url' })).toThrow()
    expect(() => convertUrlTool.input.parse({ url: 'https://example.com' })).not.toThrow()
  })

  test('rejects unknown fetcher values', () => {
    expect(() =>
      convertUrlTool.input.parse({ url: 'https://example.com', fetcher: 'playwright' }),
    ).toThrow()
  })
})
