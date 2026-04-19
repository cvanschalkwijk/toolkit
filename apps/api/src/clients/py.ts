/**
 * Shared HTTP client for the Python sidecar at `${PY_URL}`.
 *
 * Every tool that needs Python-backed work goes through this module — don't
 * construct URLs in tool files directly. Centralising the transport gives us:
 *   - one place to tune timeouts / retries
 *   - a consistent error shape for tool handlers to rethrow
 *   - easy mocking in tests (tools import `pyJson` / `pyMultipart`, tests
 *     mock `globalThis.fetch`)
 */

import { env } from '../lib/env'

/**
 * Thrown by `pyJson` / `pyMultipart` when the sidecar returns a non-2xx.
 * `status` is the HTTP status code; `detail` is the parsed body (if any) so
 * callers can pick up structured fields like `category` on 501s.
 */
export class PyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'PyError'
  }
}

export interface PyCallOptions {
  /** Abort after this many milliseconds. Default: 60_000 (60s). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as { detail?: unknown; error?: unknown }
    const detail = b.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') {
      const m = (detail as { message?: unknown }).message
      if (typeof m === 'string') return m
    }
    if (typeof b.error === 'string') return b.error
  }
  return fallback
}

async function handle<T>(res: Response): Promise<T> {
  const body = await parseBody(res)
  if (!res.ok) {
    throw new PyError(extractMessage(body, `sidecar returned ${res.status}`), res.status, body)
  }
  return body as T
}

/** POST a JSON body to the sidecar and return the parsed JSON response. */
export async function pyJson<T>(
  path: `/${string}`,
  body: unknown,
  opts: PyCallOptions = {},
): Promise<T> {
  const url = `${env().PY_URL}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return await handle<T>(res)
  } catch (e) {
    if (e instanceof PyError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new PyError(`sidecar call ${path} timed out`, 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new PyError(`sidecar call ${path} failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}

/** POST a multipart form (file upload) to the sidecar and return the parsed JSON response. */
export async function pyMultipart<T>(
  path: `/${string}`,
  form: FormData,
  opts: PyCallOptions = {},
): Promise<T> {
  const url = `${env().PY_URL}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    return await handle<T>(res)
  } catch (e) {
    if (e instanceof PyError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new PyError(`sidecar call ${path} timed out`, 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new PyError(`sidecar call ${path} failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}
