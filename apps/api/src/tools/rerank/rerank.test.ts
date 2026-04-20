import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __resetEnvCacheForTests } from '../../lib/env'
import { rerankTool } from './rerank'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetEnvCacheForTests()
  process.env.RERANKER_URL = 'http://reranker.test:7997'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(process.env, 'RERANKER_URL')
  __resetEnvCacheForTests()
})

describe('rerankTool', () => {
  test('POSTs to the reranker and returns documents in score order', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.3 },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const out = await rerankTool.execute({
      query: 'what is a panda',
      documents: ['hello', 'the giant panda is a bear'],
    })

    expect(out.results).toEqual([
      { index: 1, document: 'the giant panda is a bear', score: 0.95 },
      { index: 0, document: 'hello', score: 0.3 },
    ])
    expect(out.reranker_used).toBe(true)
    expect(out.query).toBe('what is a panda')
  })

  test('rejects empty documents at the schema boundary', () => {
    expect(() => rerankTool.input.parse({ query: 'x', documents: [] })).toThrow()
    expect(() => rerankTool.input.parse({ query: 'x', documents: ['a'] })).not.toThrow()
  })

  test('rejects empty query', () => {
    expect(() => rerankTool.input.parse({ query: '', documents: ['a'] })).toThrow()
  })

  test('caps documents list at 200', () => {
    const docs = Array.from({ length: 201 }, (_, i) => `d${i}`)
    expect(() => rerankTool.input.parse({ query: 'x', documents: docs })).toThrow()
  })

  test('exposes a valid MCP-compatible schema shape', () => {
    expect(rerankTool.name).toBe('rerank')
    expect(rerankTool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(rerankTool.description.length).toBeGreaterThan(20)
    expect(rerankTool.category).toBe('rerank')
    expect(rerankTool.http.path).toBe('/rerank')
  })
})
