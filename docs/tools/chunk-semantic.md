# `chunk_semantic`

Split text into topic-aware chunks using sentence-embedding breakpoints.

## Purpose

**When to use:** you have a document you want to feed into RAG retrieval and care about chunk quality. Fixed-size chunks cut mid-sentence and separate sentences that belong together; semantic chunking watches sentence-to-sentence similarity and breaks at the sharpest drops, keeping related sentences in one chunk.

**When NOT to use:**

- You need per-chunk embeddings in the same call — use [`chunk_late`](chunk-late.md).
- You need deterministic slice points (chunk boundaries always at exact byte offsets) — use fixed-size chunking via `/chunk` with `strategy=fixed`.
- The text is very short (< 200 chars) — chunking is overkill.

## Signature

- **HTTP:** `POST /chunk/semantic`
- **MCP:** `chunk_semantic`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | The text to chunk. Max 1 MB. |
| `breakpoint_percentile` | int (50–99) | no | `95` | Percentile of similarity-drop magnitudes that triggers a boundary. Higher = fewer, larger chunks. |
| `embedding_model` | string | no | `sentence-transformers/all-MiniLM-L6-v2` | HuggingFace model ID for the encoder. |

## Output

```json
{
  "chunks": [
    { "text": "...", "index": 0, "start": 0, "end": 412 },
    { "text": "...", "index": 1, "start": 412, "end": 901 }
  ],
  "count": 2,
  "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
  "embedding_dim": 0,
  "strategy": "semantic"
}
```

`embedding_dim` is always `0` for this tool — it doesn't return per-chunk vectors. Use `chunk_late` if you need them.

## Examples

### HTTP

```bash
curl -sS -X POST http://localhost:3000/chunk/semantic \
  -H 'content-type: application/json' \
  -d '{"text":"Intro paragraph about cats. More about cats. Now onto dogs. Dogs are different from cats. Finally, a word on birds."}' \
  | jq '{count, chunks: [.chunks[] | {index, len: (.end - .start), preview: (.text | .[0:40])}]}'
```

Example output:

```json
{
  "count": 3,
  "chunks": [
    { "index": 0, "len": 43, "preview": "Intro paragraph about cats. More about cats" },
    { "index": 1, "len": 42, "preview": "Now onto dogs. Dogs are different from cat" },
    { "index": 2, "len": 28, "preview": "Finally, a word on birds." }
  ]
}
```

### Chained with conversion

```bash
# Convert a PDF to markdown, then chunk it semantically in two calls.
MD=$(curl -sS -X POST http://localhost:3000/convert/file \
  -H 'content-type: application/json' \
  -d "{\"file_base64\":\"$(base64 -w0 report.pdf)\",\"filename\":\"report.pdf\"}" \
  | jq -r '.markdown')

curl -sS -X POST http://localhost:3000/chunk/semantic \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg t "$MD" '{text: $t}')" \
  | jq '.count'
```

### From an agent (MCP)

Wire the toolkit into any MCP-aware agent framework (see [README](../../README.md#use-it-from-an-agent)) and `chunk_semantic` shows up alongside every other tool. Natural fit for refinery pipelines — e.g., `convert_url` → `chunk_semantic` → per-chunk reasoning / summarisation / `extract_structured`. The `chunks` array comes back as the tool result; the agent iterates through sections without ever putting the full source in its own context.

## Notes & caveats

- **First-call warmup:** the encoder is lazily loaded on first use. Expect a 3–5 s cold start; subsequent calls are ~50–200 ms depending on text length.
- **Model choice:** the default MiniLM model is small (80 MB) and fast. For better quality on long / domain-specific text, try `sentence-transformers/multi-qa-mpnet-base-dot-v1` or a domain-tuned model.
- **Offsets:** `start` / `end` are character offsets into the input text. They're heuristic when the chunker normalised whitespace — don't rely on them for exact re-splicing.
- **Min/max chunk size:** not enforced. If you need hard caps, post-filter the output or run `chunk_late` which uses fixed-size windows.
- **Errors:** `501` if the sidecar was built without `[chunk]` extras.

## See also

- [`chunk_late`](chunk-late.md) — per-chunk embeddings included, uses long-context model.
- [LangChain SemanticChunker](https://python.langchain.com/docs/how_to/semantic-chunker/)
