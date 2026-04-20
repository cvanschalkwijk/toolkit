import { z } from '@hono/zod-openapi'
import { rerank as rerankCall } from '../../clients/reranker'
import { defineTool } from '../../lib/tool'

/**
 * Standalone rerank tool — sort a list of documents by relevance to a
 * query. Complements the auto-rerank inside `web_search` by exposing the
 * same backend for arbitrary RAG / research / triage workflows (rerank
 * chunked doc excerpts before stuffing a context window, pick best
 * customer-support reply from a candidate set, etc.).
 *
 * Backend contract is the Cohere-compatible /rerank shape — point
 * RERANKER_URL at any service that speaks it:
 *   - Infinity with BAAI/bge-reranker-v2-m3 (recommended default, see
 *     https://huggingface.co/BAAI/bge-reranker-v2-m3 — 568M, multilingual,
 *     fast, fp16 works fine)
 *   - HuggingFace TEI with a cross-encoder model
 *   - Cohere's hosted rerank-v3 (paid)
 *   - A FastAPI wrapper around FlagEmbedding's FlagReranker
 */
export const rerankTool = defineTool({
  name: 'rerank',
  description:
    'Sort a list of documents by relevance to a query using a cross-encoder reranker backend. Use when you have N candidate texts (RAG chunks, search hits from somewhere else, support-article snippets, …) and need the top-K most relevant to a query — cross-encoders beat embedding-cosine similarity on precision by a wide margin for a ~100ms per-batch cost. Requires RERANKER_URL to be set (e.g. Infinity serving BAAI/bge-reranker-v2-m3). Returns results in relevance-descending order with scores in [0, 1]. See docs/tools/rerank.md.',
  category: 'rerank',
  http: { method: 'post', path: '/rerank' },
  input: z
    .object({
      query: z
        .string()
        .min(1)
        .max(2_000)
        .describe('The query (user question, intent, topic) to score documents against.'),
      documents: z
        .array(z.string().min(1))
        .min(1)
        .max(200)
        .describe(
          'Documents to score. Typically search-result snippets, RAG chunks, or short passages. Each is fed to the reranker as a (query, document) pair; keep each under the backend\u2019s sequence-length limit (bge-reranker-v2-m3: 512 tokens).',
        ),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Return only the top-N by score. Default: return all documents sorted.'),
      model: z
        .string()
        .optional()
        .describe(
          'Override the backend\u2019s default model. Usually unnecessary — leave unset and rely on RERANKER_MODEL / the backend default.',
        ),
    })
    .openapi('RerankInput'),
  output: z
    .object({
      query: z.string(),
      results: z
        .array(
          z.object({
            index: z.number().int().describe('Zero-based index into the original documents array.'),
            document: z.string().describe('The document text, echoed for convenience.'),
            score: z.number().describe('Relevance score in [0, 1] — higher is more relevant.'),
          }),
        )
        .describe('Results in relevance-descending order.'),
      reranker_used: z.literal(true),
      duration_ms: z.number().int(),
    })
    .openapi('RerankOutput'),
  execute: async ({ query, documents, top_n, model }) => {
    const started = Date.now()
    const scored = await rerankCall({ query, documents, topN: top_n, model })
    const results = scored
      .filter((r) => r.index >= 0 && r.index < documents.length)
      .map((r) => ({
        index: r.index,
        document: documents[r.index] as string,
        score: r.score,
      }))
    return {
      query,
      results,
      reranker_used: true as const,
      duration_ms: Date.now() - started,
    }
  },
})
