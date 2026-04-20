/**
 * Shared HTTP client for a SearXNG metasearch instance at `${SEARXNG_URL}`.
 *
 * Every tool that talks to SearXNG goes through this module — don't construct
 * URLs in tool files directly. Mirrors `clients/py.ts` so the pattern stays
 * consistent: one place to tune timeouts, one error type for handlers to
 * rethrow, one mock target for tests (stub `globalThis.fetch`).
 */

import { env } from '../lib/env'

export class SearxngError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'SearxngError'
  }
}

export interface SearxngCallOptions {
  /** Abort after this many milliseconds. Default: 20_000 (20s). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * SearXNG params accept primitives and arrays (the latter joined with commas —
 * SearXNG's documented multi-value syntax for `categories` and `engines`).
 */
export type SearxngParams = Record<string, string | number | boolean | string[] | undefined>

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function buildUrl(base: string, path: `/${string}`, params: SearxngParams): string {
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`)
  url.searchParams.set('format', 'json')
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      url.searchParams.set(key, value.join(','))
    } else {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/** GET a JSON payload from SearXNG. `format=json` is appended automatically. */
export async function searxng<T>(
  path: `/${string}`,
  params: SearxngParams,
  opts: SearxngCallOptions = {},
): Promise<T> {
  const url = buildUrl(env().SEARXNG_URL, path, params)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await parseBody(res)
    if (!res.ok) {
      throw new SearxngError(`searxng returned ${res.status}`, res.status, body)
    }
    return body as T
  } catch (e) {
    if (e instanceof SearxngError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new SearxngError(`searxng call ${path} timed out`, 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new SearxngError(`searxng call ${path} failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}
