# `chunk_late`

Late chunking: embed the whole document once in a long-context encoder, then split into chunks and mean-pool the token embeddings that fall in each chunk's span. Every returned chunk embedding carries document-wide context.

## Purpose

**When to use:** you're building a RAG index and your documents have reference chains ("their policy", "the above algorithm", "as mentioned earlier") that lose meaning when chunked and embedded in isolation. Late chunking preserves those references in each chunk's vector.

**When NOT to use:**

- You don't need embeddings back — use [`chunk_semantic`](chunk-semantic.md), which finds topic breaks without returning vectors.
- Your documents are very short (< 512 chars) — one chunk is enough.
- You need fully offline / CPU-only deployment and can't pull the jina-v3 model (~1 GB) — stick with [`chunk_semantic`](chunk-semantic.md) + a small encoder.

## Signature

- **HTTP:** `POST /chunk/late`
- **MCP:** `chunk_late`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | The text to chunk. Truncated to 8192 tokens by the encoder — `truncated: true` in the response when that happens. |
| `chunk_size` | int (16–8192) | no | `512` | Character-size of each chunk window. |
| `overlap` | int (0–4096) | no | `50` | Character overlap between adjacent chunks. |
| `embedding_model` | string | no | `jinaai/jina-embeddings-v3` | HuggingFace model ID. Model must support `trust_remote_code=True`. |

## Output

```json
{
  "chunks": [
    {
      "text": "Intro paragraph about the toolkit…",
      "index": 0,
      "start": 0,
      "end": 512,
      "embedding": [0.12, -0.04, 0.31, ... 1024 floats ...]
    },
    { "text": "…", "index": 1, "start": 462, "end": 974, "embedding": [...] }
  ],
  "count": 2,
  "embedding_model": "jinaai/jina-embeddings-v3",
  "embedding_dim": 1024,
  "strategy": "late",
  "truncated": false
}
```

## Examples

### HTTP

```bash
curl -sS -X POST http://localhost:3000/chunk/late \
  -H 'content-type: application/json' \
  -d '{"text":"Article text here — thousands of words...","chunk_size":512,"overlap":50}' \
  | jq '{count, dim: .embedding_dim, first_chunk_vec_len: (.chunks[0].embedding | length)}'
```

Example output:

```json
{
  "count": 12,
  "dim": 1024,
  "first_chunk_vec_len": 1024
}
```

### Building a local vector index

```bash
# Assume you've already converted a PDF to markdown via convert_file.
curl -sS -X POST http://localhost:3000/chunk/late \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg t "$MD" '{text: $t, chunk_size: 400, overlap: 80}')" \
  > chunks.json

# chunks.json is now ready to upsert into pgvector/Qdrant/Weaviate/etc.
jq '.chunks[] | {text, vector: .embedding}' chunks.json | head
```

### MCP

> *Chunk this whitepaper with `chunk_late` so I can stash the embeddings in my vector DB.*

The LLM client calls the tool and hands the structured result back for the agent to pipe wherever it needs.

## Notes & caveats

- **Global context preserved:** the key property of late chunking. A phrase like "their 2024 dividend" in chunk 8 still has a vector that "knows" about the company named in chunk 1.
- **Truncation:** jina-v3 caps at 8192 tokens (~32K chars for English). For longer docs, the `truncated` flag in the response is `true`. Pre-split the doc semantically, then late-chunk each section.
- **Memory:** each chunk embedding is `embedding_dim × 8` bytes (typically 1024 floats = 8 KB). A 100-chunk response is ~800 KB of embeddings over the wire.
- **First-call warmup:** jina-v3 pulls ~1 GB of weights on first call. Subsequent calls reuse the in-process cache.
- **GPU:** honoured automatically if `torch.cuda.is_available()`. CPU works but is ~10× slower on long docs.
- **Errors:** `501` if the sidecar was built without `[chunk]` extras.

## See also

- [Jina's late-chunking blog post](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)
- [`chunk_semantic`](chunk-semantic.md) — topic-break chunking without embeddings.
- [`jina-embeddings-v3` model card](https://huggingface.co/jinaai/jina-embeddings-v3)
