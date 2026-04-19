import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chunkLateTool } from './chunk-late'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('chunkLateTool', () => {
  test('POSTs to /chunk with strategy=late and returns chunks with embeddings', async () => {
    let captured: { body?: string } = {}
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = { body: init?.body as string }
      return new Response(
        JSON.stringify({
          chunks: [
            {
              text: 'First chunk.',
              index: 0,
              start: 0,
              end: 12,
              embedding: [0.1, 0.2, 0.3, 0.4],
            },
          ],
          count: 1,
          embedding_model: 'jinaai/jina-embeddings-v3',
          embedding_dim: 4,
          strategy: 'late',
          truncated: false,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await chunkLateTool.execute({
      text: 'First chunk.',
      chunk_size: 512,
      overlap: 50,
    })
    expect(out.count).toBe(1)
    expect(out.strategy).toBe('late')
    expect(out.chunks[0]?.embedding).toHaveLength(4)
    expect(out.embedding_dim).toBe(4)

    const body = JSON.parse(captured.body as string)
    expect(body.strategy).toBe('late')
    expect(body.chunk_size).toBe(512)
    expect(body.overlap).toBe(50)
  })

  test('rejects chunk_size above 8192 (jina-v3 context cap)', () => {
    expect(() => chunkLateTool.input.parse({ text: 'x', chunk_size: 9000 })).toThrow()
  })
})
