import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const convertUrlTool = defineTool({
  name: 'convert_url',
  description:
    'Fetch a URL and convert its content to LLM-efficient Markdown. `auto` defaults to trafilatura which extracts ONLY the article body (drops nav, ads, footer, sidebars) — best for news / blog pages. Pass engine="markitdown" for whole-page transcription (YouTube transcripts, audio URLs, arbitrary HTML). Pass engine="docling" for structured PDFs where table/heading fidelity matters. When a site returns a Cloudflare / WAF challenge, set fetcher="stealth" to route through the bundled FlareSolverr proxy (requires `docker compose --profile stealth up`); trafilatura still does the extraction on stealth-fetched HTML. See docs/tools/convert-url.md.',
  category: 'convert',
  http: { method: 'post', path: '/convert/url' },
  input: z
    .object({
      url: z.string().url().describe('Absolute URL to fetch.'),
      engine: z
        .enum(['auto', 'markitdown', 'docling', 'trafilatura'])
        .default('auto')
        .describe(
          'For URLs, `auto` resolves to trafilatura (article-body extraction). Pass `markitdown` for whole-page transcription (YouTube/audio), `docling` for structured PDFs.',
        ),
      format: z.enum(['markdown', 'json', 'html']).default('markdown'),
      fetcher: z
        .enum(['direct', 'stealth'])
        .default('direct')
        .describe(
          'Fetch strategy. `direct` (default) has the engine fetch the URL itself — fast, fine for most public pages. `stealth` routes through FlareSolverr (headful Chromium) to bypass Cloudflare / WAF challenges; requires the `stealth` compose profile to be up. Stealth returns HTML only, so YouTube-transcript / audio handlers on markitdown do not fire on this path.',
        ),
    })
    .openapi('ConvertUrlInput'),
  output: z
    .object({
      markdown: z.string(),
      engine_used: z.enum(['markitdown', 'docling', 'trafilatura']),
      fetcher_used: z.enum(['direct', 'stealth']).optional(),
      format: z.enum(['markdown', 'json', 'html']),
      source: z.object({ url: z.string() }),
      duration_ms: z.number().int(),
      metadata: z
        .object({
          title: z.string().nullable().optional(),
          author: z.string().nullable().optional(),
          date: z.string().nullable().optional(),
          sitename: z.string().nullable().optional(),
          categories: z.array(z.string()).nullable().optional(),
          tags: z.array(z.string()).nullable().optional(),
        })
        .partial()
        .optional()
        .describe('Structured metadata from trafilatura when extracted. Empty for other engines.'),
    })
    .openapi('ConvertUrlOutput'),
  execute: async (input) => pyJson('/convert/url', input, { timeoutMs: 120_000 }),
})
