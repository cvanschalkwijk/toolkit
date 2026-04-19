import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const chunkLateTool = defineTool({
  name: 'chunk_late',
  description:
    'Late chunking: encode the whole document in one pass with a long-context embedding model, then split into chunks and mean-pool the token embeddings per chunk. Unlike per-chunk embedding, each returned vector carries global document context — reference phrases like "their policy" keep their meaning. Uses jinaai/jina-embeddings-v3 by default. See docs/tools/chunk-late.md.',
  category: 'chunk',
  http: { method: 'post', path: '/chunk/late' },
  input: z
    .object({
      text: z.string().min(1).max(1_000_000).describe('The text to chunk.'),
      chunk_size: z
        .number()
        .int()
        .min(16)
        .max(8192)
        .default(512)
        .describe('Target chunk size in characters.'),
      overlap: z
        .number()
        .int()
        .min(0)
        .max(4096)
        .default(50)
        .describe('Character overlap between adjacent chunks.'),
      embedding_model: z
        .string()
        .optional()
        .describe('HuggingFace model ID. Defaults to `jinaai/jina-embeddings-v3`.'),
    })
    .openapi('ChunkLateInput'),
  output: z
    .object({
      chunks: z.array(
        z.object({
          text: z.string(),
          index: z.number().int(),
          start: z.number().int(),
          end: z.number().int(),
          embedding: z.array(z.number()),
        }),
      ),
      count: z.number().int(),
      embedding_model: z.string(),
      embedding_dim: z.number().int(),
      strategy: z.literal('late'),
      truncated: z.boolean().optional(),
    })
    .openapi('ChunkLateOutput'),
  execute: async (input) =>
    pyJson('/chunk', { ...input, strategy: 'late' }, { timeoutMs: 120_000 }),
})
