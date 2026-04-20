import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../lib/env'
import { ClassifierError, classify, isClassifierConfigured } from './classifier'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.CLASSIFIER_URL = 'http://classifier.test:8080'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(process.env, 'CLASSIFIER_URL')
  __resetEnvCacheForTests()
})

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch
}

describe('isClassifierConfigured', () => {
  test('true when CLASSIFIER_URL is set', () => {
    expect(isClassifierConfigured()).toBe(true)
  })

  test('false when CLASSIFIER_URL is unset', () => {
    Reflect.deleteProperty(process.env, 'CLASSIFIER_URL')
    __resetEnvCacheForTests()
    expect(isClassifierConfigured()).toBe(false)
  })
})

describe('classify', () => {
  test('POSTs {text} to CLASSIFIER_URL/classify and flattens the nested results', async () => {
    let captured: { url?: string; body?: unknown } = {}
    mockFetch(async (url, init) => {
      captured = { url, body: JSON.parse(init?.body as string) }
      return new Response(
        JSON.stringify({
          model: 'argilla/ModernBERT-domain-classifier',
          results: [
            [
              { label: 'finance', score: 0.92 },
              { label: 'news', score: 0.05 },
              { label: 'science', score: 0.03 },
            ],
          ],
        }),
        { status: 200 },
      )
    })

    const out = await classify({ text: 'interest rates rose again' })
    expect(captured.url).toBe('http://classifier.test:8080/classify')
    expect(captured.body).toEqual({ text: 'interest rates rose again' })
    expect(out).toEqual([
      { label: 'finance', score: 0.92 },
      { label: 'news', score: 0.05 },
      { label: 'science', score: 0.03 },
    ])
  })

  test('forwards top_k when provided', async () => {
    let body: Record<string, unknown> = {}
    mockFetch(async (_u, init) => {
      body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ results: [[]] }), { status: 200 })
    })
    await classify({ text: 'x', topK: 4 })
    expect(body.top_k).toBe(4)
  })

  test('throws 503 when CLASSIFIER_URL is unset', async () => {
    Reflect.deleteProperty(process.env, 'CLASSIFIER_URL')
    __resetEnvCacheForTests()
    try {
      await classify({ text: 'x' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ClassifierError)
      expect((e as ClassifierError).status).toBe(503)
    }
  })

  test('surfaces non-2xx as ClassifierError with upstream status', async () => {
    mockFetch(async () => new Response('bad', { status: 422 }))
    await expect(classify({ text: 'x' })).rejects.toMatchObject({
      name: 'ClassifierError',
      status: 422,
    })
  })

  test('throws 504 on timeout', async () => {
    mockFetch(
      async (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    await expect(classify({ text: 'x' }, { timeoutMs: 20 })).rejects.toMatchObject({
      name: 'ClassifierError',
      status: 504,
    })
  })

  test('throws 502 when response is missing results', async () => {
    mockFetch(async () => new Response(JSON.stringify({ foo: 1 }), { status: 200 }))
    await expect(classify({ text: 'x' })).rejects.toMatchObject({
      name: 'ClassifierError',
      status: 502,
    })
  })
})
