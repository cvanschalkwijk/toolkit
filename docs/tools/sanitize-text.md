# `sanitize_text`

Detect and redact personally identifiable information (PII) in a text blob.

## Purpose

**When to use:** you're about to send text to an external LLM (OpenAI, Anthropic, Google) and want to strip PII first. This tool uses Microsoft Presidio's analyzer + anonymizer pipeline, which recognises emails, phone numbers, SSNs, credit card numbers, names, locations, IP addresses, and more.

**When NOT to use:**

- You only care about a single fixed pattern (e.g., just email addresses) — a regex is simpler and 100× faster.
- You need 100% recall on a specific PII category — Presidio is good but not perfect; for regulated-data flows add a second verifier or a human review step.
- The text is already sanitized — calling this twice on already-redacted text is a no-op but still consumes a sidecar roundtrip.

## Signature

- **HTTP:** `POST /sanitize/text`
- **MCP:** `sanitize_text`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | The text to sanitize. Max 1 MB. |
| `entities` | string[] | no | *(Presidio default recognizers)* | Which PII entity types to look for. Full list: [Presidio entity types](https://microsoft.github.io/presidio/supported_entities/). |
| `anonymization` | `redact \| replace \| hash \| mask` | no | `redact` | How to rewrite detected spans (see below). |
| `language` | string (ISO-639-1) | no | `en` | Analyzer language. |

### Anonymization modes

| Mode | Example input | Example output |
|---|---|---|
| `redact` | `Email: alice@example.com` | `Email: <REDACTED>` |
| `replace` | `Email: alice@example.com` | `Email: <EMAIL_ADDRESS>` |
| `mask` | `Email: alice@example.com` | `Email: *****************` |
| `hash` | `Email: alice@example.com` | `Email: 7b8a2c…f04` (SHA-256) |

## Output

```json
{
  "sanitized_text": "Please reach <REDACTED> at <REDACTED> or call <REDACTED>.",
  "redactions": [
    { "entity_type": "PERSON",        "start":  13, "end": 24, "score": 0.85 },
    { "entity_type": "EMAIL_ADDRESS", "start":  28, "end": 51, "score": 1.00 },
    { "entity_type": "PHONE_NUMBER",  "start":  60, "end": 72, "score": 0.75 }
  ],
  "anonymization": "redact",
  "language": "en",
  "duration_ms": 42
}
```

`start` and `end` are character offsets into the **original** (pre-sanitization) text.

## Examples

### HTTP — default redact mode

```bash
curl -sS -X POST http://localhost:3000/sanitize/text \
  -H 'content-type: application/json' \
  -d '{"text":"Hi, I'\''m Alice Jones. Email: alice@example.com. SSN: 123-45-6789."}' \
  | jq '{sanitized: .sanitized_text, redactions: [.redactions[].entity_type]}'
```

Example output:

```json
{
  "sanitized": "Hi, I'm <REDACTED>. Email: <REDACTED>. SSN: <REDACTED>.",
  "redactions": ["PERSON", "EMAIL_ADDRESS", "US_SSN"]
}
```

### HTTP — label-replacement mode for auditable traces

```bash
curl -sS -X POST http://localhost:3000/sanitize/text \
  -H 'content-type: application/json' \
  -d '{"text":"Call 415-555-0100 or email alice@acme.co.","anonymization":"replace"}' \
  | jq '.sanitized_text'
```

```
"Call <PHONE_NUMBER> or email <EMAIL_ADDRESS>."
```

### Gating LLM calls

A typical agent pattern: sanitize user input, send the result to an external LLM, then map the LLM's response back onto the original spans if needed.

```bash
CLEAN=$(curl -sS -X POST http://localhost:3000/sanitize/text \
  -H 'content-type: application/json' \
  -d "{\"text\": \"$USER_INPUT\", \"anonymization\": \"replace\"}" \
  | jq -r '.sanitized_text')

# Now it's safe to hit OpenAI / Anthropic / etc. with CLEAN.
```

### From an agent (MCP)

Register the toolkit URL with any MCP-aware agent framework (see [README](../../README.md#use-it-from-an-agent)) and `sanitize_text` becomes an available tool. A common pattern is slotting it as a guard step in a refinery pipeline — e.g., `convert_url` → `sanitize_text` → `chunk_semantic` — so PII never reaches downstream LLM calls or vector-store writes. The scrubbed text comes back as the tool result; the agent continues the workflow with that instead of the raw input.

## Notes & caveats

- **First-call warmup:** Presidio loads spaCy's `en_core_web_lg` on the first call (~500 MB model, ~3 s load). Subsequent calls are ~50–200 ms.
- **Recall vs precision:** Presidio is tuned for recall. Expect some false positives (e.g., Capital-letter words flagged as `PERSON`). For deterministic flows use `entities` to restrict to only the types you care about.
- **Custom entities:** not exposed in v1. To add a recognizer (domain-specific identifier, internal ID format), customise the analyzer on the Python side — reach into `presidio_runner._analyzer()` from code for now. A future `custom_recognizers` input is on the roadmap.
- **Language:** Presidio supports multiple languages but each needs its own spaCy model installed. Only `en` ships in the default Docker build.
- **Errors:** `501` if the sidecar was built without `[sanitize]` extras or spaCy's model isn't installed.

## See also

- [Microsoft Presidio docs](https://microsoft.github.io/presidio/)
- [Supported entities list](https://microsoft.github.io/presidio/supported_entities/)
