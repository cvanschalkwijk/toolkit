/**
 * Tests for the Python sidecar client. Mocks globalThis.fetch so we can
 * verify URL construction, error shape, and timeout handling without
 * standing up a real sidecar.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PyError, pyJson, pyMultipart } from './py'

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

describe('pyJson', () => {
  test('POSTs JSON to PY_URL + path and returns parsed response', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    mockFetch(async (url, init) => {
      captured = { url: url as string, init }
      return new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const out = await pyJson<{ hello: string }>('/foo', { x: 1 })
    expect(out.hello).toBe('world')
    expect(captured.url).toBe('http://sidecar.test:8000/foo')
    expect(captured.init?.method).toBe('POST')
    expect(JSON.parse(captured.init?.body as string)).toEqual({ x: 1 })
  })

  test('throws PyError with status + parsed detail on non-2xx', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: { message: 'bad format', category: 'convert' } }), {
          status: 415,
        }),
    )
    await expect(pyJson('/convert/file', {})).rejects.toMatchObject({
      name: 'PyError',
      status: 415,
      message: 'bad format',
    })
  })

  test('surfaces 501 not-installed as a structured PyError', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: { message: 'install extras', category: 'chunk' } }), {
          status: 501,
        }),
    )
    try {
      await pyJson('/chunk', { text: 'hi', strategy: 'semantic' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PyError)
      const pe = e as PyError
      expect(pe.status).toBe(501)
      expect(pe.message).toBe('install extras')
      expect((pe.detail as { detail: { category: string } }).detail.category).toBe('chunk')
    }
  })

  test('falls back to status-based message when body has no detail', async () => {
    mockFetch(async () => new Response('', { status: 500 }))
    await expect(pyJson('/oops', {})).rejects.toMatchObject({
      status: 500,
      message: 'sidecar returned 500',
    })
  })

  test('throws a 504 PyError on timeout', async () => {
    mockFetch(
      async (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    await expect(pyJson('/slow', {}, { timeoutMs: 20 })).rejects.toMatchObject({
      name: 'PyError',
      status: 504,
    })
  })

  test('throws a 502 PyError on connection failure', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(pyJson('/any', {})).rejects.toMatchObject({
      name: 'PyError',
      status: 502,
    })
  })
})

describe('pyMultipart', () => {
  test('POSTs the supplied FormData as-is', async () => {
    let captured: { init?: RequestInit } = {}
    mockFetch(async (_u, init) => {
      captured = { init }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const form = new FormData()
    form.append('file', new Blob(['hello']), 'x.txt')
    form.append('engine', 'markitdown')
    const out = await pyMultipart<{ ok: boolean }>('/convert/file', form)
    expect(out.ok).toBe(true)
    expect(captured.init?.method).toBe('POST')
    // Body passed through unchanged (FormData with its generated boundary).
    expect(captured.init?.body).toBe(form)
  })
})
