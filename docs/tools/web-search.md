# `web_search`

Search the public web via a self-hosted [SearXNG](https://github.com/searxng/searxng) metasearch instance.

## Purpose

**When to use:**

- The LLM needs information past its training cutoff.
- You want citation URLs for a claim.
- You need results aggregated across multiple engines without picking one.
- Fresh news / recent events.

**When NOT to use:**

- You already know the URL and want its contents — use [`convert_url`](convert-url.md).
- You want the raw HTML of a result — `web_search` returns titles + snippets only; follow up with `convert_url` on a result URL.
- The content is behind auth — SearXNG fetches engines as an anonymous client.

## Signature

- **HTTP:** `POST /web/search`
- **MCP:** `web_search`

## Input

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string (1–500) | yes | — | The search query. |
| `categories` | array of `general \| images \| videos \| news \| map \| music \| it \| science \| files \| social_media` | no | instance default (`general`) | SearXNG category filter. Multiple values are ANDed. |
| `engines` | string[] | no | instance-enabled set | Restrict to specific engines by name, e.g. `["duckduckgo","brave"]`. |
| `language` | string | no | instance default | Language code, e.g. `en`, `en-US`, or `all`. |
| `time_range` | `day \| week \| month \| year` | no | none | Restrict results to this recency window. |
| `safesearch` | int 0–2 | no | `1` | 0 = off, 1 = moderate, 2 = strict. |
| `pageno` | int 1–10 | no | `1` | Result page number. |
| `max_results` | int 1–50 | no | `10` | Upper bound on returned results after SearXNG dedupe. |

## Output

```json
{
  "query": "claude opus 4.7",
  "results": [
    {
      "title": "Claude Opus 4.7 — Anthropic",
      "url": "https://www.anthropic.com/news/claude-opus-4-7",
      "snippet": "Claude Opus 4.7 is Anthropic's most capable model…",
      "engine": "duckduckgo",
      "score": 1.0,
      "published_date": "2026-03-15",
      "category": "general"
    }
  ],
  "suggestions": ["claude 4.7 api", "claude opus pricing"],
  "answers": [],
  "infoboxes": [],
  "duration_ms": 812
}
```

`suggestions`, `answers`, and `infoboxes` are often empty; they're passed through when SearXNG returns them.

## Examples

### HTTP

```bash
curl -sS -X POST http://localhost:3000/web/search \
  -H 'content-type: application/json' \
  -d '{"query":"claude opus 4.7","max_results":3}' \
  | jq '.results[] | {title, url, engine}'
```

### HTTP — fresh news only

```bash
curl -sS -X POST http://localhost:3000/web/search \
  -H 'content-type: application/json' \
  -d '{"query":"nvidia earnings","categories":["news"],"time_range":"week"}'
```

### MCP — from an agent

> *Use the `web_search` tool to find Anthropic's announcement of Claude 4.7 and its pricing page.*

The LLM calls `web_search`, inspects result URLs, and can chain `convert_url` on a promising hit.

## Running the backend

Two options — pick one:

**Option 1: bundled instance.** Runs a SearXNG container on the same compose network.

```bash
export SEARXNG_SECRET=$(openssl rand -hex 32)
docker compose --profile search up -d
```

Debug UI and `/stats` page are at <http://localhost:8080> (loopback-only by default).

**Option 2: BYO instance.** Point the api at any reachable SearXNG by setting `SEARXNG_URL` in `.env`. The bundled profile stays down.

```bash
# .env
SEARXNG_URL=http://searxng.my-network.internal:8080
```

## Notes & caveats

- **JSON API gotcha.** SearXNG ships with the JSON output format *disabled* — if you BYO an instance and haven't added `json` to `search.formats`, every call returns 403. The bundled config enables it; if you roll your own, copy that line from `searxng/settings.yml`.
- **Engine blocking.** The bundled config ships with eleven engines:
  - **General web:** `duckduckgo`, `brave`, `mojeek`, `qwant`, `google`, `bing` — six indexes for recall diversity.
  - **Text/long-form niche:** `marginalia`.
  - **Reference (populates `infoboxes`/`answers`):** `wikipedia`, `wikidata`.
  - **Tech/code (rate-limited but not banned, no API keys needed):** `stackoverflow`, `github`.

  Google and Bing aggressively rate-limit scraped traffic — expect intermittent 429s from both. Brave's scrape endpoint also rate-limits under burst (supplying a free [Brave Search API key](https://api-dashboard.search.brave.com/) and pointing the engine at `braveapi` eliminates it). SearXNG silently drops any engine that 429s or errors, so the JSON API still returns whatever succeeded — failures degrade recall, not availability.
- **No tracking, no API keys.** SearXNG scrapes engines' HTML pages by default. For Brave specifically, supplying an API key (free 2k/mo tier) via SearXNG config switches that engine to the official API and eliminates scrape-blocking risk — optional.
- **Rate limits.** SearXNG's `server.limiter` is disabled in the bundled config because the api is the only client. If you expose the UI broadly, re-enable it.
- **Auth'd pages aren't reachable.** SearXNG fetches engines as an anonymous client; same for the `convert_url` chain-follow. Pre-fetch auth'd content yourself and pass bytes to `convert_file`.
- **Errors:**
  - `502` — connection to SearXNG failed (instance down, wrong URL, DNS).
  - `504` — request to SearXNG timed out (default 20 s).
  - Any non-2xx from SearXNG is surfaced as a `SearxngError` with the upstream status code.

## See also

- [`convert_url`](convert-url.md) — fetch a specific URL's contents as Markdown. Pair with `web_search` to research → read.
- [SearXNG docs](https://docs.searxng.org/) — instance config, engine list.
