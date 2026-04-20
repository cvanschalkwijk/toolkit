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
| `fetcher` | `direct \| stealth` | no | `direct` | `direct` — the engine fetches the URL itself (fast, fine for most public pages). `stealth` — route through FlareSolverr (headful Chromium) to bypass Cloudflare / WAF challenges. Requires the `stealth` compose profile to be up. See notes below. |

## Output

```json
{
  "markdown": "# Markdown\n\nMarkdown is a lightweight markup language…",
  "engine_used": "markitdown",
  "fetcher_used": "direct",
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

### HTTP — bypass a Cloudflare / WAF block

```bash
curl -sS -X POST http://localhost:3000/convert/url \
  -H 'content-type: application/json' \
  -d '{"url":"https://some-cf-walled-site.example.com/article","fetcher":"stealth"}' \
  | jq '{engine_used, fetcher_used, preview: (.markdown | .[0:200])}'
```

The sidecar POSTs to FlareSolverr's `/v1` endpoint (headful Chromium), waits for the JS challenge to resolve, and hands the rendered HTML to markitdown for the markdown conversion.

### From an agent (MCP)

With the toolkit registered as an MCP tool source (see [README](../../README.md#use-it-from-an-agent)), the agent picks `convert_url` on its own from instructions like *"grab the transcript from this YouTube URL and summarise it"*. The Markdown comes back as the tool result and flows into the next step — commonly a `chunk_semantic` + summarize pass, or a direct `extract_structured` call if the shape is known up front.

When the agent sees a first call return empty markdown or an error that looks like a challenge page, it can retry the same URL with `fetcher="stealth"` and usually succeed.

## Notes & caveats

- **No auth support.** The sidecar does plain GET requests. Pre-fetch with your own client for private content.
- **Redirects:** followed automatically by `requests` (up to 30 hops).
- **Rate limits:** your client bears them. If you convert the same URL often, cache at your layer.
- **Large pages:** a 10 MB HTML page can take 5–10 s. Adjust your client timeout accordingly; the sidecar's default is 60 s.

### Stealth (FlareSolverr) path

- Bring up the backend with `docker compose --profile stealth up -d`. Pulls a ~500 MB image with a headful Chromium; the first request warms up in ~5–10 s.
- The py sidecar reads `FLARESOLVERR_URL` (default `http://flaresolverr:8191`). Point it at any other instance to BYO.
- **HTML only.** FlareSolverr returns the rendered HTML page, not raw bytes — a stealth request to a direct PDF URL returns Chrome's PDF-viewer HTML, not the PDF bytes. For CF-walled binaries, use the stealth path to grab the *page* that links the file, extract the direct URL, then fetch that separately (many CDNs don't CF-block binary endpoints).
- **No YouTube / audio handlers.** markitdown's URL-specific code paths (YouTube transcript API, audio transcription) only fire on the `direct` path. Stealth always produces HTML → markdown.
- **Paid captcha solvers off by default.** FlareSolverr will *not* solve full hCaptcha / reCAPTCHA unless you wire in a paid solver via `FLARESOLVERR_CAPTCHA_SOLVER`. It handles Cloudflare's Turnstile and ordinary JS challenges without one.
- **Session reuse not yet exposed.** FlareSolverr supports `session` IDs to reuse a solved cookie jar across calls. Not surfaced here; each stealth call is a fresh Chromium context, so per-request cost is higher than session-pooled usage would be.
- **Errors:**
  - `502 upstream fetch failed` — DNS, TLS, connection-reset, or non-2xx from the origin (direct) / FlareSolverr unreachable (stealth).
  - `422 conversion failed` — fetched successfully but the engine couldn't parse.
  - `501` — sidecar was built without `[convert]` extras.
  - `FetchError: ... solver is not enabled` — FlareSolverr detected a captcha it refuses to solve without a paid integration.

## See also

- [`convert_file`](convert-file.md) — same tool for file-byte input.
- [markitdown supported formats](https://github.com/microsoft/markitdown#supported-formats)
