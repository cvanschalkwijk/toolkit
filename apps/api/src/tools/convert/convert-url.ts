import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const convertUrlTool = defineTool({
  name: 'convert_url',
  description:
    'Fetch a URL (webpage, YouTube, audio file, direct PDF link, etc.) and convert its content to LLM-efficient Markdown. Defaults to markitdown which handles web pages, YouTube transcripts, and audio URLs natively; pass engine="docling" when the URL points at a structured document you want parsed with layout preservation. See docs/tools/convert-url.md.',
  category: 'convert',
  http: { method: 'post', path: '/convert/url' },
  input: z
    .object({
      url: z.string().url().describe('Absolute URL to fetch.'),
      engine: z
        .enum(['auto', 'markitdown', 'docling'])
        .default('auto')
        .describe(
          'For URLs, `auto` resolves to markitdown (broad coverage). Pass `docling` for structured PDF URLs where table/heading fidelity matters.',
        ),
      format: z.enum(['markdown', 'json', 'html']).default('markdown'),
    })
    .openapi('ConvertUrlInput'),
  output: z
    .object({
      markdown: z.string(),
      engine_used: z.enum(['markitdown', 'docling']),
      format: z.enum(['markdown', 'json', 'html']),
      source: z.object({ url: z.string() }),
      duration_ms: z.number().int(),
    })
    .openapi('ConvertUrlOutput'),
  execute: async (input) => pyJson('/convert/url', input, { timeoutMs: 120_000 }),
})
