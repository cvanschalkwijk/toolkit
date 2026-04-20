/**
 * HTTP client for a Cohere-compatible reranker endpoint at `${RERANKER_URL}`.
 *
 * Every tool that talks to a reranker goes through this module — centralises
 * transport, timeout, and error shape. Mirrors clients/searxng.ts and
 * clients/py.ts.
 *
 * Expected API shape is the /rerank shape popularised by Cohere and supported
 * by Infinity, HuggingFace TEI, FlagEmbedding wrappers, etc.:
 *
 *   POST {base}/rerank
 *   {"query": "...", "documents": ["...", "..."], "top_n": N, "model": "..."}
 *
 *   -> {
 *        "results": [
 *          {"index": 1, "relevance_score": 0.97},
 *          {"index": 0, "relevance_score": 0.42}
 *        ],
 *        ...
 *      }
 *
 * Deploy candidates for the backend (not exhaustive):
 *   - Infinity + BAAI/bge-reranker-v2-m3 (recommended default — multilingual,
 *     568M params, ~1.5 GB VRAM): https://huggingface.co/BAAI/bge-reranker-v2-m3
 *   - HuggingFace TEI with any cross-encoder reranker
 *   - Cohere's hosted rerank-v3 for a managed option
 *   - A FastAPI wrapper around FlagEmbedding's FlagReranker
 */

import { env } from '../lib/env'

export class RerankerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'RerankerError'
  }
}

export interface RerankRequest {
  query: string
  documents: string[]
  /** Return only the top N results (by score). Default: all of them. */
  topN?: number
  /** Override the backend's model name. Default: env RERANKER_MODEL (if set). */
  model?: string
}

export interface RerankResult {
  /** Zero-based index into the ORIGINAL documents array. */
  index: number
  /** Relevance score. Higher = more relevant. Normalised to [0, 1] by Infinity. */
  score: number
}

export interface RerankerCallOptions {
  /** Abort after this many milliseconds. Default: 20_000 (20s). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

interface RerankApiResponse {
  results?: Array<{
    index: number
    relevance_score: number
    document?: unknown
  }>
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Is the reranker configured at all? Callers can use this to skip the rerank
 * step without paying the cost of constructing a failing request.
 */
export function isRerankerConfigured(): boolean {
  return env().RERANKER_URL !== undefined
}

/**
 * POST (query, documents) to the configured reranker. Returns the results
 * in the reranker's order (highest score first), NOT the input order.
 *
 * Throws RerankerError if RERANKER_URL isn't set — callers should guard with
 * isRerankerConfigured() when the rerank step is optional.
 */
export async function rerank(
  req: RerankRequest,
  opts: RerankerCallOptions = {},
): Promise<RerankResult[]> {
  const base = env().RERANKER_URL
  if (!base) {
    throw new RerankerError(
      'RERANKER_URL is not set — cannot rerank without a configured backend.',
      503,
    )
  }
  if (req.documents.length === 0) return []

  const url = `${base.replace(/\/$/, '')}/rerank`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const body: Record<string, unknown> = {
    query: req.query,
    documents: req.documents,
  }
  if (req.topN !== undefined) body.top_n = req.topN
  const model = req.model ?? env().RERANKER_MODEL
  if (model) body.model = model

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const parsed = (await parseBody(res)) as RerankApiResponse | string | null
    if (!res.ok) {
      throw new RerankerError(`reranker returned ${res.status}`, res.status, parsed)
    }
    const results = (
      parsed && typeof parsed === 'object' && 'results' in parsed ? parsed.results : undefined
    ) as RerankApiResponse['results']
    if (!Array.isArray(results)) {
      throw new RerankerError('reranker response missing `results` array', 502, parsed)
    }
    // Normalise the shape. The backend returns results in score-descending
    // order already; we preserve that.
    return results.map((r) => ({ index: r.index, score: r.relevance_score }))
  } catch (e) {
    if (e instanceof RerankerError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new RerankerError('reranker call timed out', 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new RerankerError(`reranker call failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}
