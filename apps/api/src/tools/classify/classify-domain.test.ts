import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../../lib/env'
import { classifyDomainTool } from './classify-domain'

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

describe('classifyDomainTool', () => {
  test('returns sorted label distribution + metadata', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'argilla/ModernBERT-domain-classifier',
          results: [
            [
              { label: 'finance', score: 0.91 },
              { label: 'news', score: 0.06 },
              { label: 'science', score: 0.03 },
            ],
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const out = await classifyDomainTool.execute({ text: 'Fed raised rates.', top_k: 3 })
    expect(out.model).toBe('argilla/ModernBERT-domain-classifier')
    expect(out.text_length).toBe('Fed raised rates.'.length)
    expect(out.results[0]?.label).toBe('finance')
    expect(out.results).toHaveLength(3)
    expect(out.duration_ms).toBeGreaterThanOrEqual(0)
  })

  test('rejects empty text', () => {
    expect(() => classifyDomainTool.input.parse({ text: '' })).toThrow()
  })

  test('caps top_k at 50', () => {
    expect(() => classifyDomainTool.input.parse({ text: 'x', top_k: 100 })).toThrow()
  })

  test('exposes valid MCP schema', () => {
    expect(classifyDomainTool.name).toBe('classify_domain')
    expect(classifyDomainTool.category).toBe('classify')
    expect(classifyDomainTool.http.path).toBe('/classify/domain')
    expect(classifyDomainTool.description.length).toBeGreaterThan(40)
  })
})
