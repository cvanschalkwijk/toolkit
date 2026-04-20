/**
 * Tests for the SearXNG client. Mocks globalThis.fetch so we can verify
 * URL + query-string construction, error shape, and timeout handling without
 * standing up a real SearXNG instance.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SearxngError, searxng } from './searxng'

const originalFetch = globalThis.fetch

// env() caches on first call — which may be from another test file that ran
// first in the suite. Setting SEARXNG_URL here matches the module default so
// assertions hold regardless of cache population order.
beforeEach(() => {
  process.env.SEARXNG_URL = 'http://searxng:8080'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch
}

describe('searxng', () => {
  test('GETs SEARXNG_URL + path with format=json and query params', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    mockFetch(async (url, init) => {
      capturedUrl = url as string
      capturedMethod = init?.method ?? ''
      return new Response(JSON.stringify({ query: 'x', results: [] }), { status: 200 })
    })

    await searxng('/search', { q: 'hello world', safesearch: 1, pageno: 1 })

    expect(capturedMethod).toBe('GET')
    const u = new URL(capturedUrl)
    expect(u.origin).toBe('http://searxng:8080')
    expect(u.pathname).toBe('/search')
    expect(u.searchParams.get('format')).toBe('json')
    expect(u.searchParams.get('q')).toBe('hello world')
    expect(u.searchParams.get('safesearch')).toBe('1')
    expect(u.searchParams.get('pageno')).toBe('1')
  })

  test('joins array params with commas and skips undefined / empty', async () => {
    let capturedUrl = ''
    mockFetch(async (url) => {
      capturedUrl = url as string
      return new Response(JSON.stringify({ query: 'x', results: [] }), { status: 200 })
    })

    await searxng('/search', {
      q: 'test',
      categories: ['general', 'news'],
      engines: [],
      language: undefined,
    })

    const u = new URL(capturedUrl)
    expect(u.searchParams.get('categories')).toBe('general,news')
    expect(u.searchParams.has('engines')).toBe(false)
    expect(u.searchParams.has('language')).toBe(false)
  })

  test('throws SearxngError with status + parsed body on non-2xx', async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ message: 'format not enabled' }), { status: 403 }),
    )
    await expect(searxng('/search', { q: 'x' })).rejects.toMatchObject({
      name: 'SearxngError',
      status: 403,
    })
  })

  test('throws a 504 SearxngError on timeout', async () => {
    mockFetch(
      async (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    await expect(searxng('/search', { q: 'x' }, { timeoutMs: 20 })).rejects.toMatchObject({
      name: 'SearxngError',
      status: 504,
    })
  })

  test('throws a 502 SearxngError on connection failure', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })
    try {
      await searxng('/search', { q: 'x' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SearxngError)
      expect((e as SearxngError).status).toBe(502)
    }
  })
})
