import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../lib/env'
import { glinerPredict, isGlinerConfigured } from './gliner'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.GLINER_URL = 'http://gliner.test:8080'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(process.env, 'GLINER_URL')
  __resetEnvCacheForTests()
})

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch
}

describe('isGlinerConfigured', () => {
  test('true when GLINER_URL is set', () => {
    expect(isGlinerConfigured()).toBe(true)
  })

  test('false when GLINER_URL is unset', () => {
    Reflect.deleteProperty(process.env, 'GLINER_URL')
    __resetEnvCacheForTests()
    expect(isGlinerConfigured()).toBe(false)
  })
})

describe('glinerPredict', () => {
  test('POSTs {text, labels, threshold} and sorts entities by score desc', async () => {
    let captured: { url?: string; body?: unknown } = {}
    mockFetch(async (url, init) => {
      captured = { url, body: JSON.parse(init?.body as string) }
      return new Response(
        JSON.stringify({
          model: 'knowledgator/modern-gliner-bi-large-v1.0',
          entities: [
            // Deliberately in document order (score-ascending) to verify sort.
            { start: 5, end: 10, text: 'later', label: 'urgency', score: 0.35 },
            { start: 0, end: 4, text: 'help', label: 'intent', score: 0.82 },
          ],
        }),
        { status: 200 },
      )
    })

    const out = await glinerPredict({
      text: 'help later please',
      labels: ['intent', 'urgency'],
      threshold: 0.3,
    })
    expect(captured.url).toBe('http://gliner.test:8080/predict')
    expect(captured.body).toEqual({
      text: 'help later please',
      labels: ['intent', 'urgency'],
      threshold: 0.3,
    })
    expect(out.map((e) => e.label)).toEqual(['intent', 'urgency'])
    expect(out[0]?.score).toBeGreaterThan(out[1]?.score ?? 0)
  })

  test('forwards flat_ner when provided', async () => {
    let body: Record<string, unknown> = {}
    mockFetch(async (_u, init) => {
      body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify({ entities: [] }), { status: 200 })
    })
    await glinerPredict({ text: 'x', labels: ['a'], flatNer: false })
    expect(body.flat_ner).toBe(false)
  })

  test('returns [] when labels list is empty without HTTP call', async () => {
    let called = false
    mockFetch(async () => {
      called = true
      return new Response('{}', { status: 200 })
    })
    const out = await glinerPredict({ text: 'x', labels: [] })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })

  test('throws 503 when GLINER_URL is unset', async () => {
    Reflect.deleteProperty(process.env, 'GLINER_URL')
    __resetEnvCacheForTests()
    await expect(glinerPredict({ text: 'x', labels: ['a'] })).rejects.toMatchObject({
      name: 'GlinerError',
      status: 503,
    })
  })

  test('surfaces non-2xx as GlinerError', async () => {
    mockFetch(async () => new Response('bad', { status: 500 }))
    await expect(glinerPredict({ text: 'x', labels: ['a'] })).rejects.toMatchObject({
      name: 'GlinerError',
      status: 500,
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
    await expect(
      glinerPredict({ text: 'x', labels: ['a'] }, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ name: 'GlinerError', status: 504 })
  })

  test('throws 502 when response is missing entities', async () => {
    mockFetch(async () => new Response(JSON.stringify({ foo: 1 }), { status: 200 }))
    await expect(glinerPredict({ text: 'x', labels: ['a'] })).rejects.toMatchObject({
      name: 'GlinerError',
      status: 502,
    })
  })
})
