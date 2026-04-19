import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chunkSemanticTool } from './chunk-semantic'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('chunkSemanticTool', () => {
  test('POSTs to /chunk with strategy=semantic and returns chunk list', async () => {
    let captured: { url?: string; body?: string } = {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, body: init?.body as string }
      return new Response(
        JSON.stringify({
          chunks: [
            { text: 'First paragraph.', index: 0, start: 0, end: 16 },
            { text: 'Second paragraph.', index: 1, start: 17, end: 34 },
          ],
          count: 2,
          embedding_model: 'sentence-transformers/all-MiniLM-L6-v2',
          embedding_dim: 0,
          strategy: 'semantic',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await chunkSemanticTool.execute({
      text: 'First paragraph. Second paragraph.',
      breakpoint_percentile: 95,
    })
    expect(out.count).toBe(2)
    expect(out.strategy).toBe('semantic')
    expect(captured.url).toBe('http://sidecar.test:8000/chunk')
    const body = JSON.parse(captured.body as string)
    expect(body.strategy).toBe('semantic')
    expect(body.text).toBe('First paragraph. Second paragraph.')
  })

  test('rejects zero-length text', () => {
    expect(() => chunkSemanticTool.input.parse({ text: '' })).toThrow()
  })
})
