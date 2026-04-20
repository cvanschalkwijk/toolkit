import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../lib/env'
import { RerankerError, isRerankerConfigured, rerank } from './reranker'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.RERANKER_URL = 'http://reranker.test:7997'
  Reflect.deleteProperty(process.env, 'RERANKER_MODEL')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(process.env, 'RERANKER_URL')
  Reflect.deleteProperty(process.env, 'RERANKER_MODEL')
  __resetEnvCacheForTests()
})

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch
}

describe('isRerankerConfigured', () => {
  test('true when RERANKER_URL is set', () => {
    expect(isRerankerConfigured()).toBe(true)
  })

  test('false when RERANKER_URL is unset', () => {
    Reflect.deleteProperty(process.env, 'RERANKER_URL')
    __resetEnvCacheForTests()
    expect(isRerankerConfigured()).toBe(false)
  })

  test('false when RERANKER_URL is empty string', () => {
    process.env.RERANKER_URL = ''
    __resetEnvCacheForTests()
    expect(isRerankerConfigured()).toBe(false)
  })
})

describe('rerank', () => {
  test('POSTs {query, documents} to RERANKER_URL/rerank', async () => {
    let captured: { url?: string; body?: unknown } = {}
    mockFetch(async (url, init) => {
      captured = { url, body: JSON.parse(init?.body as string) }
      return new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.92 },
            { index: 0, relevance_score: 0.11 },
          ],
        }),
        { status: 200 },
      )
    })

    const out = await rerank({
      query: 'what is a panda',
      documents: ['hello world', 'the giant panda is a bear'],
    })

    expect(captured.url).toBe('http://reranker.test:7997/rerank')
    expect(captured.body).toEqual({
      query: 'what is a panda',
      documents: ['hello world', 'the giant panda is a bear'],
      // Default model comes from env.ts's RERANKER_MODEL default.
      model: 'BAAI/bge-reranker-v2-m3',
    })
    expect(out).toEqual([
      { index: 1, score: 0.92 },
      { index: 0, score: 0.11 },
    ])
  })

  test('forwards topN and model when provided', async () => {
    let body: Record<string, unknown> = {}
    mockFetch(async (_u, init) => {
      body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })

    await rerank({
      query: 'x',
      documents: ['a', 'b', 'c'],
      topN: 2,
      model: 'BAAI/bge-reranker-v2-m3',
    })

    expect(body.top_n).toBe(2)
    expect(body.model).toBe('BAAI/bge-reranker-v2-m3')
  })

  test('defaults model to BAAI/bge-reranker-v2-m3 when nothing overrides', async () => {
    let body: Record<string, unknown> = {}
    mockFetch(async (_u, init) => {
      body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })

    await rerank({ query: 'x', documents: ['a'] })
    expect(body.model).toBe('BAAI/bge-reranker-v2-m3')
  })

  test('RERANKER_MODEL env overrides the default', async () => {
    process.env.RERANKER_MODEL = 'custom/other-reranker'
    __resetEnvCacheForTests()
    let body: Record<string, unknown> = {}
    mockFetch(async (_u, init) => {
      body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })

    await rerank({ query: 'x', documents: ['a'] })
    expect(body.model).toBe('custom/other-reranker')
  })

  test('returns [] when documents list is empty (no HTTP call)', async () => {
    let called = false
    mockFetch(async () => {
      called = true
      return new Response('{}', { status: 200 })
    })
    const out = await rerank({ query: 'x', documents: [] })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })

  test('throws RerankerError with status 503 when RERANKER_URL is unset', async () => {
    Reflect.deleteProperty(process.env, 'RERANKER_URL')
    __resetEnvCacheForTests()
    try {
      await rerank({ query: 'x', documents: ['a'] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(RerankerError)
      expect((e as RerankerError).status).toBe(503)
    }
  })

  test('surfaces non-2xx as RerankerError with upstream status', async () => {
    mockFetch(async () => new Response('bad request', { status: 400 }))
    await expect(rerank({ query: 'x', documents: ['a'] })).rejects.toMatchObject({
      name: 'RerankerError',
      status: 400,
    })
  })

  test('throws a 504 RerankerError on timeout', async () => {
    mockFetch(
      async (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    await expect(rerank({ query: 'x', documents: ['a'] }, { timeoutMs: 20 })).rejects.toMatchObject(
      { name: 'RerankerError', status: 504 },
    )
  })

  test('throws on malformed response missing results array', async () => {
    mockFetch(async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }))
    await expect(rerank({ query: 'x', documents: ['a'] })).rejects.toMatchObject({
      name: 'RerankerError',
      status: 502,
    })
  })
})
