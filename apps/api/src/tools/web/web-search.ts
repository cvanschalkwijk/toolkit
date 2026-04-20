import { z } from '@hono/zod-openapi'
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
    })
    .openapi('WebSearchInput'),
  output: z
    .object({
      query: z.string(),
      results: z.array(searxngResultSchema),
      suggestions: z.array(z.string()),
      answers: z.array(z.string()),
      infoboxes: z.array(searxngInfoboxSchema),
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

    const results = (raw.results ?? []).slice(0, input.max_results).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? '',
      engine: r.engine,
      score: r.score,
      published_date: r.publishedDate,
      category: r.category,
    }))

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
      duration_ms: Date.now() - started,
    }
  },
})
