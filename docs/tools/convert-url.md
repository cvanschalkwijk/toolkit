# `convert_url`

Fetch a URL and convert its content to LLM-efficient Markdown.

## Purpose

**When to use:** you have a web page, YouTube video (for transcript), audio file, or direct document URL, and want clean Markdown for an LLM. The toolkit does the fetch + conversion in one call, so your agent doesn't have to juggle HTTP clients and encoders.

**When NOT to use:**

- The input is already bytes on disk — use [`convert_file`](convert-file.md).
- The content is behind auth — the sidecar fetch has no credential support; pre-fetch client-side and pass bytes to `convert_file`.
- You need the structured page (DOM tree) — this returns a single Markdown blob.

## Signature

- **HTTP:** `POST /convert/url`
- **MCP:** `convert_url`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string (URL) | yes | — | Absolute URL to fetch. |
| `engine` | `auto \| markitdown \| docling` | no | `auto` | For URLs, `auto` resolves to markitdown (broadest format coverage — HTML, YouTube, audio). Pass `docling` when the URL points at a PDF and you want structural fidelity. |
| `format` | `markdown \| json \| html` | no | `markdown` | Output format. `json` and `html` are docling-only. |

## Output

```json
{
  "markdown": "# Markdown\n\nMarkdown is a lightweight markup language…",
  "engine_used": "markitdown",
  "format": "markdown",
  "source": { "url": "https://en.wikipedia.org/wiki/Markdown" },
  "duration_ms": 812
}
```

## Examples

### HTTP — convert a Wikipedia article

```bash
curl -sS -X POST http://localhost:3000/convert/url \
  -H 'content-type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/Markdown"}' \
  | jq '{engine_used, duration_ms, preview: (.markdown | .[0:200])}'
```

Example output:

```json
{
  "engine_used": "markitdown",
  "duration_ms": 812,
  "preview": "# Markdown\n\nMarkdown is a lightweight markup language for creating formatted text using a plain-text editor. John Gruber created Markdown in 2004 as a markup language that is appealing…"
}
```

### HTTP — extract a YouTube transcript

```bash
curl -sS -X POST http://localhost:3000/convert/url \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  | jq '.markdown | .[0:300]'
```

markitdown fetches the YouTube transcript API and formats as plain Markdown with timestamps.

### HTTP — direct PDF URL with docling

```bash
curl -sS -X POST http://localhost:3000/convert/url \
  -H 'content-type: application/json' \
  -d '{"url":"https://arxiv.org/pdf/2312.11805.pdf","engine":"docling"}' \
  | jq '.engine_used, .duration_ms'
```

### From an agent (MCP)

With the toolkit registered as an MCP tool source (see [README](../../README.md#use-it-from-an-agent)), the agent picks `convert_url` on its own from instructions like *"grab the transcript from this YouTube URL and summarise it"*. The Markdown comes back as the tool result and flows into the next step — commonly a `chunk_semantic` + summarize pass, or a direct `extract_structured` call if the shape is known up front.

## Notes & caveats

- **No auth support.** The sidecar does plain GET requests. Pre-fetch with your own client for private content.
- **Redirects:** followed automatically by `requests` (up to 30 hops).
- **Rate limits:** your client bears them. If you convert the same URL often, cache at your layer.
- **Large pages:** a 10 MB HTML page can take 5–10 s. Adjust your client timeout accordingly; the sidecar's default is 60 s.
- **Errors:**
  - `502 upstream fetch failed` — DNS, TLS, connection-reset, or non-2xx from the origin.
  - `422 conversion failed` — fetched successfully but the engine couldn't parse.
  - `501` — sidecar was built without `[convert]` extras.

## See also

- [`convert_file`](convert-file.md) — same tool for file-byte input.
- [markitdown supported formats](https://github.com/microsoft/markitdown#supported-formats)
