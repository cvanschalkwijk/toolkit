/**
 * HTTP client for the domain classifier service at `${CLASSIFIER_URL}`.
 *
 * Expects a FastAPI-style `/classify` endpoint that returns a sorted
 * label distribution per input text:
 *
 *   POST {base}/classify
 *   {"text": "...", "top_k": 5}
 *   -> {
 *     "model": "argilla/ModernBERT-domain-classifier",
 *     "results": [
 *       [ {"label": "finance", "score": 0.95}, {"label": "news", "score": 0.03}, ... ]
 *     ]
 *   }
 *
 * The bitdream `classifier-service` (see bitdream repo) implements this
 * shape on top of transformers' text-classification pipeline. Any other
 * wrapper with the same contract works too.
 *
 * Mirrors clients/reranker.ts / clients/searxng.ts — single error type,
 * single place to tune timeouts, easy to mock in tests.
 */

import { env } from '../lib/env'

export class ClassifierError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ClassifierError'
  }
}

export interface ClassifyRequest {
  text: string
  /** If set, return only the top-K labels. Otherwise all labels. */
  topK?: number
}

export interface LabelScore {
  label: string
  score: number
}

export interface ClassifierCallOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

interface ClassifyApiResponse {
  model?: string
  results?: Array<Array<{ label: string; score: number }>>
}

export function isClassifierConfigured(): boolean {
  return env().CLASSIFIER_URL !== undefined
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
 * POST a single text to the classifier. Returns the label distribution
 * in score-descending order.
 */
export async function classify(
  req: ClassifyRequest,
  opts: ClassifierCallOptions = {},
): Promise<LabelScore[]> {
  const base = env().CLASSIFIER_URL
  if (!base) {
    throw new ClassifierError(
      'CLASSIFIER_URL is not set — cannot classify without a configured backend.',
      503,
    )
  }

  const url = `${base.replace(/\/$/, '')}/classify`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const body: Record<string, unknown> = { text: req.text }
  if (req.topK !== undefined) body.top_k = req.topK

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const parsed = (await parseBody(res)) as ClassifyApiResponse | string | null
    if (!res.ok) {
      throw new ClassifierError(`classifier returned ${res.status}`, res.status, parsed)
    }
    const results =
      parsed && typeof parsed === 'object' && 'results' in parsed ? parsed.results : undefined
    // The service returns results as a list-of-lists (one per input text).
    // We send a single text, so take the first sub-array.
    const first = Array.isArray(results) ? results[0] : undefined
    if (!Array.isArray(first)) {
      throw new ClassifierError('classifier response missing `results[0]` array', 502, parsed)
    }
    return first.map((r) => ({ label: r.label, score: r.score }))
  } catch (e) {
    if (e instanceof ClassifierError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new ClassifierError('classifier call timed out', 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new ClassifierError(`classifier call failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}
