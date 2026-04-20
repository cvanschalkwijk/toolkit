import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../../lib/env'
import { webSearchTool } from './web-search'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.SEARXNG_URL = 'http://searxng:8080'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  __resetEnvCacheForTests()
})

function stubSearxng(body: unknown) {
  let capturedUrl = ''
  globalThis.fetch = (async (url: string) => {
    capturedUrl = url
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
  return () => capturedUrl
}

describe('webSearchTool', () => {
  test('maps SearXNG results into the output schema', async () => {
    const getUrl = stubSearxng({
      query: 'claude',
      results: [
        {
          title: 'Claude',
          url: 'https://claude.ai',
          content: 'Anthropic assistant.',
          engine: 'duckduckgo',
          score: 1.2,
          publishedDate: '2026-01-10',
          category: 'general',
        },
      ],
      suggestions: ['claude ai'],
      answers: ['Claude is made by Anthropic.'],
      infoboxes: [
        {
          infobox: 'Claude',
          content: 'AI assistant by Anthropic.',
          urls: [{ title: 'Website', url: 'https://anthropic.com' }],
        },
      ],
    })

    const out = await webSearchTool.execute({
      query: 'claude',
      safesearch: 1,
      pageno: 1,
      max_results: 10,
    })

    expect(out.query).toBe('claude')
    expect(out.results).toHaveLength(1)
    expect(out.results[0]).toMatchObject({
      title: 'Claude',
      url: 'https://claude.ai',
      snippet: 'Anthropic assistant.',
      engine: 'duckduckgo',
      score: 1.2,
      published_date: '2026-01-10',
      category: 'general',
    })
    expect(out.suggestions).toEqual(['claude ai'])
    expect(out.answers).toEqual(['Claude is made by Anthropic.'])
    expect(out.infoboxes).toEqual([
      { title: 'Claude', content: 'AI assistant by Anthropic.', url: 'https://anthropic.com' },
    ])
    expect(out.duration_ms).toBeGreaterThanOrEqual(0)

    const u = new URL(getUrl())
    expect(u.pathname).toBe('/search')
    expect(u.searchParams.get('q')).toBe('claude')
    expect(u.searchParams.get('format')).toBe('json')
    expect(u.searchParams.get('safesearch')).toBe('1')
  })

  test('truncates results to max_results', async () => {
    stubSearxng({
      query: 'x',
      results: Array.from({ length: 20 }, (_, i) => ({
        title: `t${i}`,
        url: `https://e.com/${i}`,
        content: '',
        engine: 'duckduckgo',
      })),
    })

    const out = await webSearchTool.execute({
      query: 'x',
      safesearch: 1,
      pageno: 1,
      max_results: 3,
    })

    expect(out.results).toHaveLength(3)
    expect(out.results[0]?.title).toBe('t0')
    expect(out.results[2]?.title).toBe('t2')
  })

  test('passes array filters to SearXNG as comma-joined values', async () => {
    const getUrl = stubSearxng({ query: 'x', results: [] })

    await webSearchTool.execute({
      query: 'x',
      categories: ['general', 'news'],
      engines: ['duckduckgo', 'brave'],
      time_range: 'week',
      language: 'en',
      safesearch: 2,
      pageno: 1,
      max_results: 10,
    })

    const u = new URL(getUrl())
    expect(u.searchParams.get('categories')).toBe('general,news')
    expect(u.searchParams.get('engines')).toBe('duckduckgo,brave')
    expect(u.searchParams.get('time_range')).toBe('week')
    expect(u.searchParams.get('language')).toBe('en')
    expect(u.searchParams.get('safesearch')).toBe('2')
  })

  test('rejects empty queries at the schema boundary', () => {
    expect(() => webSearchTool.input.parse({ query: '' })).toThrow()
    expect(() => webSearchTool.input.parse({ query: 'ok' })).not.toThrow()
  })

  test('rejects safesearch and pageno out of range', () => {
    expect(() => webSearchTool.input.parse({ query: 'x', safesearch: 5 })).toThrow()
    expect(() => webSearchTool.input.parse({ query: 'x', pageno: 99 })).toThrow()
    expect(() => webSearchTool.input.parse({ query: 'x', max_results: 500 })).toThrow()
  })

  test('applies default safesearch and pageno when omitted', () => {
    const parsed = webSearchTool.input.parse({ query: 'x' })
    expect(parsed.safesearch).toBe(1)
    expect(parsed.pageno).toBe(1)
    expect(parsed.max_results).toBe(10)
  })

  test('exposes a valid MCP-compatible schema shape', () => {
    expect(webSearchTool.name).toBe('web_search')
    expect(webSearchTool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(webSearchTool.description.length).toBeGreaterThan(20)
    expect(webSearchTool.category).toBe('web')
    expect(webSearchTool.http.path).toBe('/web/search')
    expect(webSearchTool.input.shape).toBeDefined()
  })
})
