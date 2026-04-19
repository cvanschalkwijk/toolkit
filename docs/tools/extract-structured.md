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

### HTTP — extract a person's bio

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

Example output:

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

### MCP — agent-driven extraction

> *Use `extract_structured` to pull a list of action items from these meeting notes into `{owner, due_date, task}[]`.*

The agent calls the tool with the notes as `text` and the schema as an array of objects, then operates on the structured result.

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
