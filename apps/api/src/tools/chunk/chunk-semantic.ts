import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const chunkSemanticTool = defineTool({
  name: 'chunk_semantic',
  description:
    'Split text into topic-aware chunks by detecting semantic shifts via sentence embeddings. Better than fixed-size chunking for RAG retrieval because related sentences stay together. Returns chunk text + character offsets; does NOT return embeddings (use `chunk_late` if you need per-chunk vectors). See docs/tools/chunk-semantic.md.',
  category: 'chunk',
  http: { method: 'post', path: '/chunk/semantic' },
  input: z
    .object({
      text: z.string().min(1).max(1_000_000).describe('The text to chunk.'),
      breakpoint_percentile: z
        .number()
        .int()
        .min(50)
        .max(99)
        .default(95)
        .describe(
          'Percentile of sentence-similarity drops that triggers a chunk boundary. Higher = fewer, larger chunks.',
        ),
      embedding_model: z
        .string()
        .optional()
        .openapi({ example: 'sentence-transformers/all-MiniLM-L6-v2' })
        .describe(
          'HuggingFace model ID for the encoder. Omit or leave blank to use `sentence-transformers/all-MiniLM-L6-v2` (small, fast).',
        ),
    })
    .openapi('ChunkSemanticInput'),
  output: z
    .object({
      chunks: z.array(
        z.object({
          text: z.string(),
          index: z.number().int(),
          start: z.number().int(),
          end: z.number().int(),
        }),
      ),
      count: z.number().int(),
      embedding_model: z.string(),
      embedding_dim: z.number().int(),
      strategy: z.literal('semantic'),
    })
    .openapi('ChunkSemanticOutput'),
  execute: async (input) =>
    pyJson('/chunk', { ...input, strategy: 'semantic' }, { timeoutMs: 90_000 }),
})
