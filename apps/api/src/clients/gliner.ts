/**
 * HTTP client for the GLiNER span-extraction service at `${GLINER_URL}`.
 *
 * Expects a FastAPI-style `/predict` endpoint that takes a text plus a
 * list of candidate labels and returns the spans in the text that
 * match each label:
 *
 *   POST {base}/predict
 *   {"text": "...", "labels": ["urgency", "intent"], "threshold": 0.5}
 *   -> {
 *     "model": "knowledgator/modern-gliner-bi-large-v1.0",
 *     "entities": [
 *       {"start": 0, "end": 12, "text": "Please cancel", "label": "intent", "score": 0.82}
 *     ]
 *   }
 *
 * The bitdream `gliner-service` implements this shape around the upstream
 * `gliner` Python library. Any wrapper matching the contract works.
 */

import { env } from '../lib/env'

export class GlinerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'GlinerError'
  }
}

export interface GlinerRequest {
  text: string
  labels: string[]
  /** Minimum confidence to keep a span. Default: backend-side 0.5. */
  threshold?: number
  /** Allow overlapping span matches (rare). Default: backend-side true (flat). */
  flatNer?: boolean
}

export interface GlinerEntity {
  start: number
  end: number
  text: string
  label: string
  score: number
}

export interface GlinerCallOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

interface GlinerApiResponse {
  model?: string
  entities?: Array<{
    start: number
    end: number
    text: string
    label: string
    score: number
  }>
}

export function isGlinerConfigured(): boolean {
  return env().GLINER_URL !== undefined
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
 * POST (text, labels) to GLiNER. Returns the matching spans in
 * score-descending order. Empty array when no span clears the threshold.
 */
export async function glinerPredict(
  req: GlinerRequest,
  opts: GlinerCallOptions = {},
): Promise<GlinerEntity[]> {
  const base = env().GLINER_URL
  if (!base) {
    throw new GlinerError(
      'GLINER_URL is not set — cannot run span extraction without a configured backend.',
      503,
    )
  }
  if (req.labels.length === 0) return []

  const url = `${base.replace(/\/$/, '')}/predict`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const body: Record<string, unknown> = { text: req.text, labels: req.labels }
  if (req.threshold !== undefined) body.threshold = req.threshold
  if (req.flatNer !== undefined) body.flat_ner = req.flatNer

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const parsed = (await parseBody(res)) as GlinerApiResponse | string | null
    if (!res.ok) {
      throw new GlinerError(`gliner returned ${res.status}`, res.status, parsed)
    }
    const entities =
      parsed && typeof parsed === 'object' && 'entities' in parsed ? parsed.entities : undefined
    if (!Array.isArray(entities)) {
      throw new GlinerError('gliner response missing `entities` array', 502, parsed)
    }
    // Sort score-desc so callers can consume the top-hit without
    // relying on backend ordering (gliner returns document order by
    // default, not score order).
    return entities
      .map((e) => ({
        start: e.start,
        end: e.end,
        text: e.text,
        label: e.label,
        score: e.score,
      }))
      .sort((a, b) => b.score - a.score)
  } catch (e) {
    if (e instanceof GlinerError) throw e
    if ((e as { name?: string } | undefined)?.name === 'AbortError') {
      throw new GlinerError('gliner call timed out', 504)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new GlinerError(`gliner call failed: ${msg}`, 502)
  } finally {
    clearTimeout(timer)
  }
}
