# `extract_structured`

Extract structured data from unstructured text by giving it a JSON Schema.

## Purpose

**When to use:** you have a blob of text and want reliable JSON matching a specific shape. LLMs are notoriously bad at adhering to schemas when you just ask nicely; this tool wraps [Instructor](https://python.useinstructor.com/), which builds a Pydantic model from your JSON Schema, passes it as a tool-call response model, validates the output, and auto-retries with the validation errors in the prompt if the LLM produced invalid JSON.

**When NOT to use:**

- Your schema fits trivially into a simple LLM prompt (e.g., one field) — a raw chat completion is cheaper.
- You need free-form text output — this is the wrong tool; call your LLM directly.

## Signature

- **HTTP:** `POST /extract/structured`
- **MCP:** `extract_structured`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | The text to extract from. Max 1 MB. |
| `schema` | object (JSON Schema) | yes | — | Target shape. See supported constructs below. |
| `model` | string | no | env `LLM_DEFAULT_MODEL` | Override the model ID per call. |
| `system_prompt` | string | no | *(safe default)* | Override the system prompt. |
| `max_retries` | int (0–10) | no | `2` | How many re-prompts Instructor performs if the LLM's output doesn't validate. |
| `temperature` | number (0–2) | no | `0.1` | LLM sampling temperature. |

### Supported JSON Schema constructs

- Primitive `type`: `string`, `integer`, `number`, `boolean`, `null`
- String `enum` → `Literal[...]`
- `array` with a single `items` schema
- `object` with `properties` + `required` (nested objects supported)
- Optional / nullable via `type: ["string", "null"]`
- `anyOf` / `oneOf` — treated as unions

Not yet supported: `$ref`, `definitions`, `pattern`, JSON Schema Draft 2020-12 specific features.

### Prefer flat schemas

**Strong recommendation: keep schemas flat.** Put every field at the top level of the object. Use prefixed keys (`person_name`, `company_name`) instead of nested objects (`{person: {name}, company: {name}}`).

Why this matters for this tool specifically:

- **Small / mid-size models** (7–13B) reliably produce flat JSON but lose accuracy rapidly as nesting depth grows. 3-level schemas often fail on anything smaller than 70B or a frontier hosted model.
- **`max_retries` isn't a rescue.** If the model can't produce the shape, three tries won't help — it'll just waste tokens and time.
- **Flat schemas arrive faster.** Fewer output tokens = lower latency and less chance the model derails mid-generation.
- **Cloud models handle nesting fine** (GPT-4o, Claude Sonnet, Gemini Pro) but still benefit from flat structures for speed and cost.

Nesting that DOES tend to work well: **one level**, used sparingly — e.g., `{field_name: {type, value}}`. Avoid nesting objects inside arrays of objects when the model is local and under ~13B.

If you need a hierarchical output shape, two safer patterns:

1. Call `extract_structured` twice with flat schemas, one per subtree, and assemble client-side.
2. Flatten during extraction, then reshape client-side with `jq` or similar:

```bash
# Extract flat
RESP=$(curl -sS -X POST http://localhost:3000/extract/structured -d '{"text":"...", "schema": {...flat...}}')

# Reshape to nested
echo "$RESP" | jq '.data | {person: {name: .person_name, role: .person_role}, company: {name: .company_name, year: .company_year}}'
```

## Output

```json
{
  "data": {
    "name": "Ada Lovelace",
    "occupation": "mathematician",
    "birth_year": 1815
  },
  "model_used": "gpt-4o-mini",
  "max_retries": 2,
  "duration_ms": 412
}
```

`data` is whatever shape your schema declared.

## Examples

### HTTP — flat bio extraction (recommended shape)

```bash
curl -sS -X POST http://localhost:3000/extract/structured \
  -H 'content-type: application/json' \
  -d '{
    "text": "Ada Lovelace, daughter of Lord Byron, is regarded as the first computer programmer. She was born in London in 1815 and died in 1852.",
    "schema": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "birth_year": { "type": "integer" },
        "death_year": { "type": "integer" },
        "field": { "type": "string" },
        "nationality": { "type": ["string", "null"] }
      },
      "required": ["name", "birth_year", "field"]
    }
  }' | jq '.data'
```

Expected:

```json
{
  "name": "Ada Lovelace",
  "birth_year": 1815,
  "death_year": 1852,
  "field": "computer programming"
}
```

### HTTP — enum-constrained classification

```bash
curl -sS -X POST http://localhost:3000/extract/structured \
  -H 'content-type: application/json' \
  -d '{
    "text": "Our CS-4000 sensor reads 34.5°C at the intake vent. All nominal.",
    "schema": {
      "type": "object",
      "properties": {
        "sensor_id": { "type": "string" },
        "temperature_c": { "type": "number" },
        "status": { "type": "string", "enum": ["nominal", "warning", "alert"] }
      },
      "required": ["sensor_id", "temperature_c", "status"]
    }
  }' | jq '.data'
```

### HTTP — multi-entity flat extraction (prefix-keyed, not nested)

This is the flat pattern that replaces "a person and a company and their education":

```bash
curl -sS -X POST http://localhost:3000/extract/structured \
  -H 'content-type: application/json' \
  -d '{
    "text": "Jensen Huang is the co-founder and CEO of NVIDIA. Born in 1963 in Taiwan, he studied electrical engineering at Oregon State and Stanford. He founded NVIDIA in 1993. The company is headquartered in Santa Clara, California, and went public on the Nasdaq in 1999.",
    "schema": {
      "type": "object",
      "properties": {
        "person_name":         { "type": "string" },
        "person_birth_year":   { "type": "integer" },
        "person_role":         { "type": "string" },
        "company_name":        { "type": "string" },
        "company_founded_year":{ "type": "integer" },
        "company_hq":          { "type": "string" },
        "listing_exchange":    { "type": "string", "enum": ["Nasdaq", "NYSE", "AMEX", "OTC"] },
        "schools":             { "type": "array", "items": { "type": "string" } }
      },
      "required": ["person_name", "company_name"]
    }
  }' | jq '.data'
```

### From an agent (MCP)

With the toolkit registered as an MCP tool source (see [README](../../README.md#use-it-from-an-agent)), `extract_structured` becomes the final stage of most refinery pipelines. Typical chain: `web_search` or `convert_url` → `sanitize_text` → `chunk_semantic` → `extract_structured`, where the last call produces the JSON object the downstream system expects (a database row, an API payload, a research card, …). The agent passes the schema + text; the tool hands back structured `data` ready for whatever consumes it next.

## Notes & caveats

- **Requires an LLM backend.** Set these env vars on the sidecar:
  - `LLM_BASE_URL` — OpenAI-compatible endpoint (e.g., `https://api.openai.com/v1`, a local llama.cpp `…/v1`, Ollama's `http://localhost:11434/v1`, etc.)
  - `LLM_API_KEY` — key for the endpoint
  - `LLM_DEFAULT_MODEL` — model ID if the request doesn't override
  If any of these are missing the tool returns **501**.
- **Tool-use capability needed.** The underlying model must support OpenAI tool-calling. For local models via llama.cpp / Ollama, pick one with a tool-calling template (Llama-3-Instruct, Mistral-Instruct, Qwen-2.5, …).
- **Cost:** each `max_retries` retry is an additional LLM call. Default `2` means up to 3 total invocations.
- **Latency budget:** the Bun timeout is 180 s by default — long enough for slow local models.
- **Schema validation happens pre-flight too.** A malformed schema returns 422 immediately without hitting the LLM.

## See also

- [Instructor documentation](https://python.useinstructor.com/)
- [JSON Schema reference](https://json-schema.org/learn/getting-started-step-by-step)
