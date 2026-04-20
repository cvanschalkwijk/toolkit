# `detect_intent`

Zero-shot span / entity / intent detection via GLiNER.

## Purpose

**When to use:**

- You want to extract spans from text that match a label set defined *at call time* — no model fine-tuning, no fixed taxonomy.
- Intent classification on user messages — "cancel", "refund", "upgrade", "complaint", "escalate".
- NER with caller-defined entity types — "person", "company", "product_name", "feature_request", "competitor_mention".
- Topic spotting: feed a paragraph + a list of candidate topics, get back which ones appear and where.

**When NOT to use:**

- The label set is fixed and stable across all calls — use [`classify_domain`](classify-domain.md) (single forward pass, probability distribution, no span boundaries).
- You need the *whole document* labelled, not spans within it — classifier is the right shape.
- Very short inputs where "span" doesn't mean anything — still works but `classify_domain` will be more reliable.

## Signature

- **HTTP:** `POST /intent/detect`
- **MCP:** `detect_intent`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string (1–50_000 chars) | yes | — | Text to extract spans from. ModernBERT-large supports up to 8K tokens before the backend truncates. |
| `labels` | string[] (1–50 items) | yes | — | Candidate labels. Use natural-language phrases — the model generalises from the label names themselves. `"user_intent"` works; `"IT_01"` does not. |
| `threshold` | float 0–1 | no | `0.5` | Minimum confidence to keep a span. Lower (0.2–0.3) for higher recall; higher (0.6+) for higher precision. |
| `flat_ner` | bool | no | `true` | If true, only top-score non-overlapping spans are returned. Set false to allow nested matches (rare). |

### Label-naming tips

GLiNER is a bi-encoder that encodes label names as text — so the label string itself IS the signal the model uses.

Good labels: `"person"`, `"company_name"`, `"user_intent"`, `"urgency_level"`, `"product_request"`, `"positive_sentiment"`.

Avoid: opaque IDs (`"TYPE_A"`), all-caps (`"INTENT"`), or numbered enums (`"intent_1"`, `"intent_2"`). The model has no idea what those mean.

## Output

```json
{
  "text_length": 87,
  "model": "knowledgator/modern-gliner-bi-large-v1.0",
  "entities": [
    { "start": 18, "end": 30, "text": "Acme Robotics", "label": "company_name", "score": 0.89 },
    { "start": 0,  "end": 6,  "text": "Please",        "label": "politeness",   "score": 0.62 },
    { "start": 45, "end": 52, "text": "refund",         "label": "user_intent",  "score": 0.48 }
  ],
  "duration_ms": 180
}
```

`entities` is in **score-descending order** (re-sorted by the client — the upstream library returns document order). Start/end are character offsets into the original `text`.

Empty array when nothing cleared the threshold. That's not an error; just means either the text doesn't contain any of the target labels or the threshold is too tight.

## Examples

### HTTP — support ticket triage

```bash
curl -sS -X POST http://localhost:3000/intent/detect \
  -H 'content-type: application/json' \
  -d '{
    "text": "Please cancel my subscription and refund the last charge. Very frustrated.",
    "labels": ["cancel", "refund", "frustrated", "subscribe", "billing_issue"],
    "threshold": 0.2
  }' | jq '.entities'
```

### HTTP — zero-shot NER on a news snippet

```bash
curl -sS -X POST http://localhost:3000/intent/detect \
  -H 'content-type: application/json' \
  -d '{
    "text": "Apple reported Q3 earnings of $89.5B on Thursday, beating Wall Street estimates.",
    "labels": ["company", "revenue", "date", "financial_metric"],
    "threshold": 0.3
  }'
```

### From an agent (MCP)

With the toolkit registered as an MCP tool source, `detect_intent` slots into support-automation and content-analysis pipelines. A typical chain:

`web_search` → `convert_url` → `chunk_semantic` → `detect_intent` per chunk with `["action_item", "decision", "risk"]` → join results back to chunks → `extract_structured` into a final report.

Or for a support workflow: incoming ticket text → `detect_intent` with `["refund", "cancel", "upgrade", "escalate", "feature_request"]` → route to the right queue based on which label scored highest.

## The backend API contract

`GLINER_URL` expects a FastAPI-style `/predict` endpoint with the following shape:

### Request

```
POST {GLINER_URL}/predict
content-type: application/json

{
  "text":      "string, required",
  "labels":    ["string", ...],
  "threshold": 0.5,
  "flat_ner":  true
}
```

### Response

```
200 OK
{
  "model": "knowledgator/modern-gliner-bi-large-v1.0",
  "entities": [
    { "start": 0, "end": 6, "text": "Please", "label": "politeness", "score": 0.62 },
    ...
  ]
}
```

The toolkit reads `entities[]` and ignores `model`; the upstream library returns entities in document order, so the client re-sorts by score before returning.

## Recommended backend

The bundled `gliner-service` in bitdream's inference stack — a FastAPI wrapper around the upstream [`gliner`](https://github.com/urchade/GLiNER) Python library. Runs `knowledgator/modern-gliner-bi-large-v1.0` in fp16 on GPU.

The GLiNER library supports a whole family of models with different size / speed / quality trade-offs:

| Model | Params | Context | Notes |
|---|---:|---:|---|
| `knowledgator/modern-gliner-bi-large-v1.0` (default) | ~400M | 8K | ModernBERT-large backbone. Best quality-per-size; multilingual. |
| `urchade/gliner_large-v2.1` | ~300M | 768 | Original bi-encoder baseline. Faster, smaller context. |
| `urchade/gliner_medium-v2.1` | ~210M | 768 | For tighter VRAM budgets. |
| `knowledgator/modern-gliner-bi-base-v1.0` | ~150M | 8K | Drop-in smaller version of the default. |

Swap the `GLINER_MODEL` env var on the bitdream service (or your own wrapper) to deploy a different one. The client contract is identical.

## Notes & caveats

- **Label names matter a lot.** Rephrasing `"IT01"` → `"urgency_level"` can move a span from 0.2 to 0.7 confidence. If results look weak, rewrite labels before changing thresholds.
- **Threshold tuning.** Default 0.5 is conservative. GLiNER scores vary by label name quality + text length; 0.2–0.3 is often appropriate for recall-focused use-cases, 0.6+ for precision.
- **Latency.** ~100–250 ms per call depending on text length and label count. Scales roughly linearly with `len(labels)` — each label is an encoder pass.
- **Long inputs truncate.** Default ModernBERT-large caps at 8K tokens; text past that is silently dropped on the backend side.
- **Multilingual.** The default model is multilingual, but quality on low-resource languages is uneven. Check the model card.
- **Errors:**
  - `503` — `GLINER_URL` not set.
  - `502` — backend unreachable or malformed response.
  - `504` — backend timed out (default 30s — higher than other tools because GLiNER is slower).

## See also

- [`classify_domain`](classify-domain.md) — fixed-taxonomy classifier. Use when the label set doesn't change per call.
- [knowledgator/modern-gliner-bi-large-v1.0 model card](https://huggingface.co/knowledgator/modern-gliner-bi-large-v1.0)
- [GLiNER library / paper](https://github.com/urchade/GLiNER)
