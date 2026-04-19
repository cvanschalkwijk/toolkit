import { z } from '@hono/zod-openapi'
import { pyMultipart } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const convertFileTool = defineTool({
  name: 'convert_file',
  description:
    'Convert an uploaded document to LLM-efficient Markdown. Supports PDF, DOCX, PPTX, XLSX, HTML, images, and more. Auto-routes to docling (better table/header structure) for Office-family docs and markitdown (broader format coverage) for everything else. See docs/tools/convert-file.md.',
  category: 'convert',
  http: { method: 'post', path: '/convert/file' },
  input: z
    .object({
      file_base64: z
        .string()
        .min(1)
        .describe('Base64-encoded file contents. Max ~50 MB depending on engine.'),
      filename: z
        .string()
        .min(1)
        .max(256)
        .describe(
          'Original filename including extension. Used for format sniffing when engine is "auto".',
        ),
      engine: z
        .enum(['auto', 'markitdown', 'docling'])
        .default('auto')
        .describe(
          'Which conversion engine to use. `auto` picks docling for PDFs and Office formats, markitdown otherwise.',
        ),
      format: z
        .enum(['markdown', 'json', 'html'])
        .default('markdown')
        .describe('Output format. `json` and `html` are docling-only.'),
    })
    .openapi('ConvertFileInput'),
  output: z
    .object({
      markdown: z
        .string()
        .describe('The converted content. Named `markdown` regardless of chosen format.'),
      engine_used: z.enum(['markitdown', 'docling']),
      format: z.enum(['markdown', 'json', 'html']),
      source: z.object({
        filename: z.string(),
        bytes: z.number().int(),
      }),
      duration_ms: z.number().int(),
    })
    .openapi('ConvertFileOutput'),
  execute: async ({ file_base64, filename, engine, format }) => {
    const buffer = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0))
    const form = new FormData()
    form.append('file', new Blob([buffer]), filename)
    form.append('engine', engine)
    form.append('format', format)
    return pyMultipart('/convert/file', form, { timeoutMs: 120_000 })
  },
})
