# `classify_domain`

Classify a piece of text into a fixed taxonomy of topical domains.

## Purpose

**When to use:**

- You need to route text (support tickets, articles, social-media posts, chat messages) into a stable bucket: Finance / News / Sports / Science / …
- You want a cheap first-pass filter before heavier processing — e.g. only run the finance-specific extraction pipeline on texts classified `finance`.
- You want confidence scores across every label in the taxonomy, not just the top-1.

**When NOT to use:**

- You need to define your own label set per call (zero-shot / caller-supplied labels) — use [`detect_intent`](detect-intent.md) instead.
- You need span boundaries (where in the text does the label apply) — again, [`detect_intent`](detect-intent.md).
- The input text is short and ambiguous (<10 chars) — any classifier will return noise. Prefer zero-shot with carefully chosen candidate labels.

## Signature

- **HTTP:** `POST /classify/domain`
- **MCP:** `classify_domain`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string (1–100_000 chars) | yes | — | Text to classify. Backend truncates past its max sequence length (default model caps at 8K tokens). |
| `top_k` | int (1–50) | no | — | Return only the top-K highest-scoring labels. Omit to return the full distribution (26 labels with the default model). |

## Output

```json
{
  "text_length": 85,
  "model": "argilla/ModernBERT-domain-classifier",
  "results": [
    { "label": "finance", "score": 0.957 },
    { "label": "news", "score": 0.028 },
    { "label": "business-and-industrial", "score": 0.008 },
    { "label": "real-estate", "score": 0.003 }
  ],
  "duration_ms": 45
}
```

Scores sum to ~1 across all labels (softmax distribution). `results` is always sorted by `score` descending.

## Examples

### HTTP — route a support ticket

```bash
curl -sS -X POST http://localhost:3000/classify/domain \
  -H 'content-type: application/json' \
  -d '{"text":"My credit card was charged twice for the subscription renewal.","top_k":3}' \
  | jq '.results'
```

```json
[
  {"label": "finance", "score": 0.84},
  {"label": "shopping", "score": 0.09},
  {"label": "business-and-industrial", "score": 0.04}
]
```

### HTTP — filter an RSS batch to finance items

```bash
for item in $(cat headlines.jsonl); do
  label=$(echo "$item" | jq -r .title \
    | curl -sS -X POST http://localhost:3000/classify/domain \
        -H 'content-type: application/json' \
        -d "$(jq -n --arg t "$(cat)" '{text: $t, top_k: 1}')" \
    | jq -r '.results[0].label')
  [ "$label" = "finance" ] && echo "$item"
done
```

### From an agent (MCP)

With the toolkit registered as an MCP tool source (see [README](../../README.md#use-it-from-an-agent)), `classify_domain` is the natural first step of any refinery that wants to fork by topic. Typical chain: `web_search` → `classify_domain` per result → filter to the target domain → `convert_url` only on the matches. Saves the agent from calling expensive conversion / extraction tools on off-topic hits.

## The backend API contract

`CLASSIFIER_URL` expects a FastAPI-style `/classify` endpoint returning a nested results array (one sub-array per input text, because the upstream transformers pipeline is batch-oriented):

### Request

```
POST {CLASSIFIER_URL}/classify
content-type: application/json

{ "text": "string, required", "top_k": 4 }
```

### Response

```
200 OK
{
  "model": "argilla/ModernBERT-domain-classifier",
  "results": [
    [
      { "label": "finance", "score": 0.957 },
      { "label": "news",    "score": 0.028 },
      ...
    ]
  ]
}
```

The toolkit reads `results[0]` (we send one text per call) and ignores everything else.

## Recommended backend

The canonical backend is the bundled `classifier-service` in bitdream's inference stack — a thin FastAPI wrapper around transformers' text-classification pipeline. It uses the [sdpa](https://pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html) attention impl (not flash-attn) to dodge a compatibility bug that takes down Infinity on ModernBERT.

The default model [`argilla/ModernBERT-domain-classifier`](https://huggingface.co/argilla/ModernBERT-domain-classifier) covers 26 domains from Google's taxonomy: `finance`, `news`, `sports`, `health`, `science`, `arts-and-entertainment`, `computers-and-electronics`, `real-estate`, `jobs-and-education`, `travel-and-transportation`, `law-and-government`, etc.

To deploy a different classifier, swap the `CLASSIFIER_MODEL` env var on the bitdream service (or whatever wrapper you run) — any HF sequence-classification model works.

## Notes & caveats

- **Stable label set.** The backend model picks the labels; per-call overrides aren't supported here. Use `detect_intent` for zero-shot.
- **Latency.** ~30–80 ms per call against the bitdream default model. fp16 + sdpa + ModernBERT-base is fast.
- **Long inputs truncate.** Default sequence cap is 8K tokens; text past that is silently dropped on the backend side.
- **Multilingual coverage** depends on the model. The default `argilla/ModernBERT-domain-classifier` is English-focused; check the model card before throwing non-English text at it.
- **Errors:**
  - `503` — `CLASSIFIER_URL` not set.
  - `502` — backend unreachable, malformed response, or non-2xx from the backend.
  - `504` — backend timed out (default 20s).

## See also

- [`detect_intent`](detect-intent.md) — zero-shot span extraction with caller-supplied labels. Use when the taxonomy changes per call.
- [argilla/ModernBERT-domain-classifier model card](https://huggingface.co/argilla/ModernBERT-domain-classifier)
- [ModernBERT paper / family](https://huggingface.co/collections/answerdotai/modernbert-67627ad707a4acbf33c41deb)
