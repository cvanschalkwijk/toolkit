/**
 * convert_file unit tests. The sidecar HTTP is mocked via globalThis.fetch
 * so we verify:
 *   - base64 decoding + multipart construction
 *   - engine + format pass-through
 *   - schema validation at the tool boundary
 *   - error pass-through from the sidecar (PyError surfaces with status)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { toStored } from '../../lib/tool'
import { convertFileTool } from './convert-file'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch
}

describe('convertFileTool', () => {
  test('POSTs multipart to /convert/file with the uploaded file', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    mockFetch(async (url, init) => {
      captured = { url: url as string, init }
      return new Response(
        JSON.stringify({
          markdown: '# Hello',
          engine_used: 'markitdown',
          format: 'markdown',
          source: { filename: 'hello.html', bytes: 10 },
          duration_ms: 12,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const html = '<h1>Hello</h1>'
    const b64 = Buffer.from(html).toString('base64')
    const result = await convertFileTool.execute({
      file_base64: b64,
      filename: 'hello.html',
      engine: 'auto',
      format: 'markdown',
    })

    expect(result.markdown).toBe('# Hello')
    expect(result.engine_used).toBe('markitdown')
    expect(captured.url).toBe('http://sidecar.test:8000/convert/file')
    expect(captured.init?.method).toBe('POST')
    // Body is FormData — verify we sent the file + fields.
    const form = captured.init?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('engine')).toBe('auto')
    expect(form.get('format')).toBe('markdown')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  test('surfaces sidecar 415 (unsupported format) as PyError', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: { message: 'unsupported input format' } }), {
          status: 415,
        }),
    )
    await expect(
      convertFileTool.execute({
        file_base64: Buffer.from('x').toString('base64'),
        filename: 'weird.xyz',
        engine: 'auto',
        format: 'markdown',
      }),
    ).rejects.toMatchObject({
      name: 'PyError',
      status: 415,
    })
  })

  test('runs against the StoredTool invoke boundary (zod parse) without throwing', async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            markdown: '# x',
            engine_used: 'docling',
            format: 'markdown',
            source: { filename: 'f.pdf', bytes: 4 },
            duration_ms: 5,
          }),
          { status: 200 },
        ),
    )
    const stored = toStored(convertFileTool)
    const raw = await stored.invoke({
      file_base64: Buffer.from('pdf!').toString('base64'),
      filename: 'f.pdf',
      engine: 'docling',
      format: 'markdown',
    })
    expect((raw as { engine_used: string }).engine_used).toBe('docling')
  })

  test('rejects invalid input through the stored invoke boundary', async () => {
    const stored = toStored(convertFileTool)
    await expect(stored.invoke({ no_file: true })).rejects.toThrow()
  })
})
