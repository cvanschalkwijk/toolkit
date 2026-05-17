import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const convertUrlTool = defineTool({
  name: 'convert_url',
  description:
    'Fetch a URL and convert its content to LLM-efficient Markdown. `auto` defaults to trafilatura which extracts ONLY the article body (drops nav, ads, footer, sidebars) — best for news / blog pages. Pass engine="markitdown" for whole-page transcription (YouTube transcripts, audio URLs, arbitrary HTML). Pass engine="docling" for structured PDFs where table/heading fidelity matters. When a site returns a Cloudflare / WAF challenge, set fetcher="stealth" to route through the bundled FlareSolverr proxy (requires `docker compose --profile stealth up`); trafilatura still does the extraction on stealth-fetched HTML. The response includes `extraction_tier` showing which trafilatura pass succeeded — when it is `"markitdown_fallback"`, the markdown is the dirty whole-page transcription, and callers can use `include_body_html=true` to receive the raw <body> HTML for LLM-based recovery. See docs/tools/convert-url.md.',
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
      include_body_html: z
        .boolean()
        .default(false)
        .describe(
          'When true, the response includes a `body_html` field carrying the inner-HTML of the page\'s <body> tag. Lets downstream consumers re-process with a different extractor or LLM without re-fetching. Off by default to keep responses small — body HTML can run 50-200 KB.',
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
      extraction_tier: z
        .enum(['trafilatura_precision', 'trafilatura_recall', 'markitdown_fallback'])
        .optional()
        .describe(
          'For engine="trafilatura": which extraction pass produced the markdown. `markitdown_fallback` means both trafilatura passes failed — downstream callers should treat the markdown as dirty (chrome included) and may want to re-extract from body_html via an LLM.',
        ),
      body_html: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Inner-HTML of the page <body>. Only present when input `include_body_html=true`. Null when no <body> tag is present (JSON fragment, etc.).',
        ),
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
