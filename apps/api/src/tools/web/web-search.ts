import { z } from '@hono/zod-openapi'
import { isRerankerConfigured, rerank } from '../../clients/reranker'
import { searxng } from '../../clients/searxng'
import { defineTool } from '../../lib/tool'

const categoryEnum = z.enum([
  'general',
  'images',
  'videos',
  'news',
  'map',
  'music',
  'it',
  'science',
  'files',
  'social_media',
])

const searxngResultSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    engine: z.string(),
    score: z.number().optional(),
    published_date: z.string().optional(),
    category: z.string().optional(),
    /**
     * Cross-encoder relevance score in [0, 1] from the reranker (when it
     * ran). Higher = more relevant. Only populated if RERANKER_URL is set
     * and rerank wasn't disabled for this call.
     */
    rerank_score: z.number().optional(),
  })
  .openapi('WebSearchResult')

const searxngInfoboxSchema = z
  .object({
    title: z.string(),
    content: z.string(),
    url: z.string().optional(),
  })
  .openapi('WebSearchInfobox')

interface SearxngApiResult {
  url: string
  title: string
  content?: string
  engine: string
  score?: number
  publishedDate?: string
  category?: string
}

interface SearxngApiInfoboxUrl {
  title?: string
  url: string
}

interface SearxngApiInfobox {
  infobox?: string
  content?: string
  urls?: SearxngApiInfoboxUrl[]
}

interface SearxngApiResponse {
  query: string
  results?: SearxngApiResult[]
  suggestions?: string[]
  answers?: string[]
  infoboxes?: SearxngApiInfobox[]
}

export const webSearchTool = defineTool({
  name: 'web_search',
  description:
    'Search the public web via a self-hosted SearXNG metasearch instance. Returns aggregated, deduplicated results (title, URL, snippet, source engine) from multiple search engines in one call. Use when the LLM needs fresh information that may be past its training cutoff, when recent news is required, or when citation URLs are needed. Prefer `convert_url` if you already have a specific URL and want its contents. No API keys are baked in; the caller controls which SearXNG instance via the SEARXNG_URL env var. See docs/tools/web-search.md.',
  category: 'web',
  http: { method: 'post', path: '/web/search' },
  input: z
    .object({
      query: z.string().min(1).max(500).describe('The search query text.'),
      categories: z
        .array(categoryEnum)
        .optional()
        .describe(
          'SearXNG category filter. Omit to use the instance default (general). Multiple values are ANDed.',
        ),
      engines: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Restrict to these SearXNG engine names (e.g. ["duckduckgo","brave"]). Omit to use the instance\u2019s enabled set.',
        ),
      language: z
        .string()
        .min(2)
        .max(10)
        .optional()
        .describe('Language code, e.g. "en", "en-US", or "all".'),
      time_range: z
        .enum(['day', 'week', 'month', 'year'])
        .optional()
        .describe('Restrict results to this recency window. Omit for no restriction.'),
      safesearch: z
        .number()
        .int()
        .min(0)
        .max(2)
        .default(1)
        .describe('SearXNG safesearch level: 0=off, 1=moderate, 2=strict.'),
      pageno: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(1)
        .describe('Result page number (1-indexed).'),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Maximum results returned to the caller after SearXNG dedupe.'),
      rerank: z
        .enum(['auto', 'on', 'off'])
        .default('auto')
        .describe(
          '`auto` (default): rerank results via the configured backend (RERANKER_URL) when one is set, otherwise return SearXNG\u2019s native ordering. `on`: require rerank and error if RERANKER_URL is unset. `off`: skip rerank even if configured.',
        ),
    })
    .openapi('WebSearchInput'),
  output: z
    .object({
      query: z.string(),
      results: z.array(searxngResultSchema),
      suggestions: z.array(z.string()),
      answers: z.array(z.string()),
      infoboxes: z.array(searxngInfoboxSchema),
      reranker_used: z.boolean(),
      duration_ms: z.number().int(),
    })
    .openapi('WebSearchOutput'),
  execute: async (input) => {
    const started = Date.now()
    const raw = await searxng<SearxngApiResponse>('/search', {
      q: input.query,
      categories: input.categories,
      engines: input.engines,
      language: input.language,
      time_range: input.time_range,
      safesearch: input.safesearch,
      pageno: input.pageno,
    })

    // Map SearXNG's verbose shape to our trimmed schema. Keep ALL results
    // (not just max_results) so the reranker can see the full candidate
    // set before we trim — a good hit buried at rank 20 in SearXNG's
    // native order can surface to the top after rerank.
    let results = (raw.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? '',
      engine: r.engine,
      score: r.score,
      published_date: r.publishedDate,
      category: r.category,
      rerank_score: undefined as number | undefined,
    }))

    const shouldRerank =
      input.rerank === 'on' || (input.rerank === 'auto' && isRerankerConfigured())
    if (input.rerank === 'on' && !isRerankerConfigured()) {
      // Explicit request with no backend — surface the misconfiguration.
      throw new Error(
        'rerank="on" but RERANKER_URL is not configured. Set RERANKER_URL or pass rerank="auto"/"off".',
      )
    }

    let rerankerUsed = false
    if (shouldRerank && results.length > 1) {
      // Build (query, snippet) pairs. bge-reranker-v2-m3 caps at 512
      // tokens; SearXNG snippets are short enough that this is a
      // non-issue. If a backend with a different length limit ever
      // needs trimming, this is the place.
      const documents = results.map(
        (r) =>
          // Fall back to title when the engine returned no snippet (some do).
          r.snippet || r.title,
      )
      const scored = await rerank({
        query: input.query,
        documents,
        // Ask for at least the user's max_results; the backend may return
        // fewer if document count is lower.
        topN: Math.min(results.length, Math.max(input.max_results, 10)),
      })
      // Re-order results by reranker output + attach scores. Any entries
      // the reranker didn't return keep their native position at the end.
      const seen = new Set<number>()
      const reordered = scored
        .filter((s) => s.index >= 0 && s.index < results.length)
        .map((s) => {
          seen.add(s.index)
          const base = results[s.index]
          if (!base) return undefined
          return { ...base, rerank_score: s.score }
        })
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
      const leftovers = results.filter((_, i) => !seen.has(i))
      results = [...reordered, ...leftovers]
      rerankerUsed = true
    }

    // Trim to max_results AFTER rerank so the reorder gets a chance to
    // surface better hits from outside the top-N.
    results = results.slice(0, input.max_results)

    const infoboxes = (raw.infoboxes ?? []).map((ib) => ({
      title: ib.infobox ?? '',
      content: ib.content ?? '',
      url: ib.urls?.[0]?.url,
    }))

    return {
      query: raw.query ?? input.query,
      results,
      suggestions: raw.suggestions ?? [],
      answers: raw.answers ?? [],
      infoboxes,
      reranker_used: rerankerUsed,
      duration_ms: Date.now() - started,
    }
  },
})
