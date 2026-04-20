import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../../lib/env'
import { webSearchTool } from './web-search'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.SEARXNG_URL = 'http://searxng:8080'
  // Default: reranker unconfigured so legacy tests see SearXNG's order.
  Reflect.deleteProperty(process.env, 'RERANKER_URL')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(process.env, 'RERANKER_URL')
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
      rerank: 'auto',
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
      rerank: 'auto',
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
      rerank: 'auto',
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

  describe('rerank integration', () => {
    /**
     * Stub both SearXNG and the reranker on a single fetch. Discriminates
     * by URL so we can return different payloads to each backend.
     */
    function stubBoth(searxngBody: unknown, rerankerBody: unknown) {
      globalThis.fetch = (async (url: string) => {
        if (url.includes('searxng')) {
          return new Response(JSON.stringify(searxngBody), { status: 200 })
        }
        if (url.includes('/rerank')) {
          return new Response(JSON.stringify(rerankerBody), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }) as unknown as typeof fetch
    }

    test('rerank="auto" with RERANKER_URL unset leaves native order', async () => {
      stubSearxng({
        query: 'q',
        results: [
          { title: 'A', url: 'https://a', content: 'aaa', engine: 'ddg' },
          { title: 'B', url: 'https://b', content: 'bbb', engine: 'ddg' },
        ],
      })
      const out = await webSearchTool.execute({
        query: 'q',
        safesearch: 1,
        pageno: 1,
        max_results: 5,
        rerank: 'auto',
      })
      expect(out.reranker_used).toBe(false)
      expect(out.results[0]?.title).toBe('A')
      expect(out.results[0]?.rerank_score).toBeUndefined()
    })

    test('rerank="auto" with RERANKER_URL set reorders by reranker score', async () => {
      process.env.RERANKER_URL = 'http://reranker.test:7997'
      __resetEnvCacheForTests()

      stubBoth(
        {
          query: 'q',
          results: [
            { title: 'A', url: 'https://a', content: 'aaa', engine: 'ddg' },
            { title: 'B', url: 'https://b', content: 'bbb', engine: 'ddg' },
            { title: 'C', url: 'https://c', content: 'ccc', engine: 'ddg' },
          ],
        },
        {
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.5 },
            { index: 1, relevance_score: 0.1 },
          ],
        },
      )

      const out = await webSearchTool.execute({
        query: 'q',
        safesearch: 1,
        pageno: 1,
        max_results: 5,
        rerank: 'auto',
      })
      expect(out.reranker_used).toBe(true)
      expect(out.results.map((r) => r.title)).toEqual(['C', 'A', 'B'])
      expect(out.results[0]?.rerank_score).toBeCloseTo(0.9, 3)
      expect(out.results[2]?.rerank_score).toBeCloseTo(0.1, 3)
    })

    test('rerank="on" without RERANKER_URL throws', async () => {
      stubSearxng({
        query: 'q',
        results: [{ title: 'A', url: 'https://a', content: '', engine: 'x' }],
      })
      await expect(
        webSearchTool.execute({
          query: 'q',
          safesearch: 1,
          pageno: 1,
          max_results: 5,
          rerank: 'on',
        }),
      ).rejects.toThrow(/RERANKER_URL/)
    })

    test('rerank="off" with RERANKER_URL set skips the reranker call', async () => {
      process.env.RERANKER_URL = 'http://reranker.test:7997'
      __resetEnvCacheForTests()

      let rerankerHit = false
      globalThis.fetch = (async (url: string) => {
        if (url.includes('searxng')) {
          return new Response(
            JSON.stringify({
              query: 'q',
              results: [{ title: 'A', url: 'https://a', content: 'x', engine: 'ddg' }],
            }),
            { status: 200 },
          )
        }
        if (url.includes('/rerank')) {
          rerankerHit = true
          return new Response(JSON.stringify({ results: [] }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }) as unknown as typeof fetch

      const out = await webSearchTool.execute({
        query: 'q',
        safesearch: 1,
        pageno: 1,
        max_results: 5,
        rerank: 'off',
      })
      expect(rerankerHit).toBe(false)
      expect(out.reranker_used).toBe(false)
    })

    test('reranker reordering runs BEFORE max_results truncation', async () => {
      process.env.RERANKER_URL = 'http://reranker.test:7997'
      __resetEnvCacheForTests()

      // 5 SearXNG results; reranker says result #4 is best. With max_results=2
      // we should see #4 and the next-highest-scored one, NOT the first
      // two from SearXNG's native order.
      stubBoth(
        {
          query: 'q',
          results: Array.from({ length: 5 }, (_, i) => ({
            title: `t${i}`,
            url: `https://e/${i}`,
            content: `c${i}`,
            engine: 'ddg',
          })),
        },
        {
          results: [
            { index: 4, relevance_score: 0.99 },
            { index: 2, relevance_score: 0.8 },
            { index: 0, relevance_score: 0.5 },
            { index: 1, relevance_score: 0.2 },
            { index: 3, relevance_score: 0.1 },
          ],
        },
      )

      const out = await webSearchTool.execute({
        query: 'q',
        safesearch: 1,
        pageno: 1,
        max_results: 2,
        rerank: 'auto',
      })
      expect(out.results.map((r) => r.title)).toEqual(['t4', 't2'])
    })
  })
})
