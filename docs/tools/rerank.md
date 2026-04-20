# `rerank`

Sort a list of documents by relevance to a query using a cross-encoder reranker.

## Purpose

**When to use:**

- You have N candidate texts (RAG chunks, search hits from some other engine, support-article excerpts, …) and need the top-K most relevant to a query.
- You want to re-rank results BEFORE stuffing them into an LLM's context window so a 4K context fills with high-signal passages instead of near-misses.
- You need materially better precision than embedding-cosine similarity without paying for a full LLM call per pair.

**When NOT to use:**

- The inputs are web search results — [`web_search`](web-search.md) has built-in auto-rerank (same backend) and skips the round-trip.
- You only need to score one (query, doc) pair — fine, but consider caching the result; reranker latency is ~50–300 ms per small batch.
- Your backend isn't configured — `rerank` requires `RERANKER_URL` to be set. The call will 503 otherwise.

## Signature

- **HTTP:** `POST /rerank`
- **MCP:** `rerank`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string (1–2000 chars) | yes | — | The query to score documents against. |
| `documents` | string[] (1–200 items) | yes | — | Texts to score. Each is fed to the reranker as a (query, document) pair. |
| `top_n` | int (1–200) | no | — | Return only the top N by score. Default: sort and return all. |
| `model` | string | no | `$RERANKER_MODEL` (= `BAAI/bge-reranker-v2-m3`) | Backend model identifier. Usually leave unset. |

**Length limits per document** depend on the backend model:

| Model | Seq limit |
|---|---|
| `BAAI/bge-reranker-v2-m3` (default, recommended) | 512 tokens |
| `BAAI/bge-reranker-v2-gemma` | 8192 tokens |
| `BAAI/bge-reranker-v2-minicpm-layerwise` | 2048 tokens |
| Cohere `rerank-v3` | 4096 tokens |

Exceeding the limit doesn't error — the backend silently truncates. Keep documents short (snippets, not full articles) or chunk first via [`chunk_semantic`](chunk-semantic.md).

## Output

```json
{
  "query": "what is a panda",
  "results": [
    { "index": 1, "document": "The giant panda is a bear native to south central China.", "score": 0.97 },
    { "index": 2, "document": "Pandas is a Python library for data analysis.", "score": 0.83 },
    { "index": 0, "document": "Hi, how are you today?", "score": 0.0001 }
  ],
  "reranker_used": true,
  "duration_ms": 94
}
```

Results are always in score-descending order. `index` points back into the original input `documents` array so you can join against whatever metadata you kept on the caller side (URLs, titles, provenance, …).

## Examples

### HTTP — sort three passages

```bash
curl -sS -X POST http://localhost:3000/rerank \
  -H 'content-type: application/json' \
  -d '{
    "query": "what is a panda",
    "documents": [
      "Hi, how are you today?",
      "The giant panda is a bear native to south central China.",
      "Pandas is a Python library for data analysis."
    ]
  }' | jq '.results[] | {score, index, preview: (.document[0:60])}'
```

### From an agent (MCP)

With the toolkit registered as an MCP tool source (see [README](../../README.md#use-it-from-an-agent)), `rerank` is a natural final step in refinery pipelines when the input candidates didn't come from `web_search`. A typical chain: your-own-retrieval → `rerank` → top-K → `extract_structured` or into an LLM prompt directly. The agent hands in its candidate list and gets back a score-sorted view for its next step.

## The backend API contract

`RERANKER_URL` is expected to expose the **Cohere-compatible `/rerank` shape**, which is what Infinity, Hugging Face TEI, FlagEmbedding wrappers, and Cohere's own hosted API all speak. Concretely:

### Request

```
POST {RERANKER_URL}/rerank
content-type: application/json

{
  "query":     "string, required",
  "documents": ["string", ...],
  "top_n":     3,
  "model":     "BAAI/bge-reranker-v2-m3"
}
```

### Response

```
200 OK
content-type: application/json

{
  "object": "rerank",
  "results": [
    { "index": 1, "relevance_score": 0.97, "document": null },
    { "index": 0, "relevance_score": 0.11, "document": null }
  ],
  "model": "BAAI/bge-reranker-v2-m3",
  "usage": { "prompt_tokens": 168, "total_tokens": 168 }
}
```

The toolkit reads `results[].index` and `results[].relevance_score` and ignores everything else, so extra fields are fine. The scores from BGE-reranker-v2-m3 are normalised by Infinity into [0, 1]; other backends may return raw logits.

## Recommended backends

| Backend | Shape | How to run |
|---|---|---|
| [Infinity](https://github.com/michaelfeil/infinity) with `BAAI/bge-reranker-v2-m3` | Cohere-compatible | `docker run michaelf34/infinity v2 --model-id BAAI/bge-reranker-v2-m3` — see https://huggingface.co/BAAI/bge-reranker-v2-m3 for the model card. Recommended default: 568M params, multilingual, ~1.5 GB VRAM at fp16, fast. |
| [Hugging Face TEI](https://github.com/huggingface/text-embeddings-inference) with any cross-encoder | Cohere-compatible | `docker run ghcr.io/huggingface/text-embeddings-inference:latest --model-id <cross-encoder>` |
| [Cohere hosted rerank-v3](https://cohere.com/rerank) | Native | Set `RERANKER_URL=https://api.cohere.com/v1`. Requires an API key; not the toolkit's default because of the key dependency. |
| Self-hosted FlagEmbedding | Wrap in FastAPI | See the [FlagEmbedding README](https://github.com/FlagOpen/FlagEmbedding) for the `FlagReranker` class; expose a `/rerank` endpoint that mirrors the shape above. |

**Ollama note:** Ollama does not serve cross-encoder rerankers natively as of early 2026 — its model surface is generation-oriented. If your local LLM story is Ollama-based, run Infinity or TEI alongside it for the reranker specifically.

## Picking a backend model

| Model | Params | Seq | Best for |
|---|---|---|---|
| `BAAI/bge-reranker-v2-m3` (default) | 568M | 512 | Multilingual, fast, "good enough" quality, lowest VRAM. Start here. |
| `BAAI/bge-reranker-v2-gemma` | 9B | 8192 | Higher quality on long English/Chinese docs. ~18 GB VRAM at fp16 — needs a proper GPU. |
| `BAAI/bge-reranker-v2-minicpm-layerwise` | 2.7B | 2048 | Middle ground; supports partial-layer inference for latency/quality trade-off. |
| `cohere/rerank-v3` (hosted) | proprietary | 4096 | Best managed option; pay per query, no self-host. |

Point `RERANKER_MODEL` (env var) or the per-call `model` input at whichever you deploy. The toolkit's code doesn't care which — only that the backend speaks the /rerank shape.

## Notes & caveats

- **Backend must be running.** The toolkit doesn't spin up a reranker — that's up to the operator. The `.env.example` documents `RERANKER_URL`.
- **First-boot warm-up.** Infinity takes ~15 s on first call to download model weights + initialise CUDA (bge-reranker-v2-m3 is ~1.5 GB). Cache persists across restarts via the HF cache volume.
- **Latency.** On a consumer GPU (e.g. RTX 2060) with `BAAI/bge-reranker-v2-m3`, expect ~50–200 ms for a batch of 10 short documents.
- **Max documents:** capped at 200 per call in the tool's input schema — a defensive ceiling, not a backend limit. Chunk larger sets if needed.
- **Errors:**
  - `503` — `RERANKER_URL` not set.
  - `502` — backend unreachable, malformed response, or non-2xx from the backend.
  - `504` — backend exceeded the 20 s timeout (default).

## See also

- [`web_search`](web-search.md) — uses the same reranker backend to auto-sort SearXNG results when `RERANKER_URL` is set.
- [BAAI/bge-reranker-v2-m3 model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)
- [Infinity serving framework](https://github.com/michaelfeil/infinity)
- [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) — BGE model family, includes the `FlagReranker` reference implementation.
