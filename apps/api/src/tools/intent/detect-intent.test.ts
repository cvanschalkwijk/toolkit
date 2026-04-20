import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../../lib/env'
import { detectIntentTool } from './detect-intent'

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

describe('detectIntentTool', () => {
  test('returns score-sorted entity spans', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'knowledgator/modern-gliner-bi-large-v1.0',
          entities: [
            { start: 12, end: 18, text: 'cancel', label: 'user_intent', score: 0.4 },
            { start: 0, end: 6, text: 'Please', label: 'politeness', score: 0.81 },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const out = await detectIntentTool.execute({
      text: 'Please help cancel',
      labels: ['user_intent', 'politeness'],
      threshold: 0.3,
      flat_ner: true,
    })
    expect(out.entities[0]?.label).toBe('politeness')
    expect(out.entities[0]?.score).toBeGreaterThan(out.entities[1]?.score ?? 0)
    expect(out.model).toBe('knowledgator/modern-gliner-bi-large-v1.0')
    expect(out.text_length).toBe('Please help cancel'.length)
  })

  test('rejects empty labels array', () => {
    expect(() => detectIntentTool.input.parse({ text: 'x', labels: [] })).toThrow()
  })

  test('caps labels at 50', () => {
    const labels = Array.from({ length: 51 }, (_, i) => `label${i}`)
    expect(() => detectIntentTool.input.parse({ text: 'x', labels })).toThrow()
  })

  test('rejects threshold out of [0,1]', () => {
    expect(() =>
      detectIntentTool.input.parse({ text: 'x', labels: ['a'], threshold: 1.5 }),
    ).toThrow()
  })

  test('defaults threshold to 0.5 and flat_ner to true', () => {
    const parsed = detectIntentTool.input.parse({ text: 'x', labels: ['intent'] })
    expect(parsed.threshold).toBe(0.5)
    expect(parsed.flat_ner).toBe(true)
  })

  test('exposes valid MCP schema', () => {
    expect(detectIntentTool.name).toBe('detect_intent')
    expect(detectIntentTool.category).toBe('intent')
    expect(detectIntentTool.http.path).toBe('/intent/detect')
    expect(detectIntentTool.description.length).toBeGreaterThan(40)
  })
})
