import { z } from 'zod'

const schema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PY_URL: z.string().url().default('http://py:8000'),
  // SearXNG metasearch instance used by the web_search tool. Default points at
  // the bundled docker-compose `searxng` service; override for BYO instances.
  SEARXNG_URL: z.string().url().default('http://searxng:8080'),
  // Optional Cohere-compatible reranker endpoint. When set, web_search
  // re-orders SearXNG results via POST {URL}/rerank, and the standalone
  // `rerank` tool becomes usable. Point at any service that speaks the
  // /rerank shape — Infinity, HuggingFace TEI, Cohere's hosted API, a
  // self-hosted FlagEmbedding wrapper, etc. Model cards to deploy behind
  // it: https://huggingface.co/BAAI/bge-reranker-v2-m3 (recommended
  // default — multilingual, 568M, fast) or bge-reranker-v2-gemma /
  // bge-reranker-v2-minicpm-layerwise when you want higher quality on
  // longer English/Chinese queries. Leave unset to disable reranking.
  // (Ollama does not serve rerankers natively as of early 2026 — use
  // Infinity or TEI if you're on that side of the ecosystem.)
  RERANKER_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  // BAAI/bge-reranker-v2-m3 is the recommended default — multilingual,
  // 568M params, ~1.5 GB VRAM at fp16, 512-token sequence cap. Override
  // if your backend is serving a different cross-encoder.
  // See https://huggingface.co/BAAI/bge-reranker-v2-m3 for the model card.
  RERANKER_MODEL: z.string().default('BAAI/bge-reranker-v2-m3'),
  // Domain-classifier service (sequence-classification text→labels).
  // When set, the classify_domain tool becomes usable. Expects a POST
  // /classify endpoint returning {results: [[{label, score}, ...]]}.
  // Works with the bundled classifier-service in bitdream's inference
  // stack (argilla/ModernBERT-domain-classifier) or any HF pipeline
  // wrapper that matches the shape.
  CLASSIFIER_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  CLASSIFIER_MODEL: z.string().default('argilla/ModernBERT-domain-classifier'),
  // GLiNER zero-shot span extraction service. When set, the detect_intent
  // tool becomes usable. Expects POST /predict returning
  // {entities: [{start, end, text, label, score}]}.
  // Works with the bundled gliner-service
  // (knowledgator/modern-gliner-bi-large-v1.0) or any FastAPI wrapper
  // that follows the same shape.
  GLINER_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  GLINER_MODEL: z.string().default('knowledgator/modern-gliner-bi-large-v1.0'),
  // LLM backend only required by the extract_structured tool; empty is OK.
  LLM_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  LLM_API_KEY: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  LLM_DEFAULT_MODEL: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Invalid environment configuration:')
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  cached = parsed.data
  return cached
}

/**
 * Clears the env() cache. Tests that mutate process.env in beforeEach need
 * this so the next env() call re-reads — otherwise cross-file run order
 * determines which test wins the cache. Not for production code.
 */
export function __resetEnvCacheForTests(): void {
  cached = undefined
}
