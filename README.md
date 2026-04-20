# toolkit

**Composable tools for LLM agents.** One TypeScript file per tool, lit up on two interfaces from the same source of truth.

- **HTTP** — Hono + OpenAPI, Swagger UI at `/`. Any language or script can hit the endpoints directly, no agent runtime required.
- **MCP** — Model Context Protocol over HTTP/SSE at `/mcp`. Point any MCP-aware agent framework at the URL and every tool registers itself automatically — no per-tool glue code to write.

Use it as a standalone utility API, wire it into an agent, or both. Adding a new tool is one file; the HTTP route, OpenAPI schema, and MCP registration all derive from that file.

## Tools

Each name links to a per-tool doc with inputs, outputs, and examples.

| Tool | Backend |
|---|---|
| [`web_search`](docs/tools/web-search.md) | [SearXNG](https://github.com/searxng/searxng) metasearch (BYO instance or `docker compose --profile search up`). Auto-reranks when `RERANKER_URL` is set. |
| [`convert_file`](docs/tools/convert-file.md) | [markitdown](https://github.com/microsoft/markitdown) + [docling](https://github.com/docling-project/docling), auto-routed by format. |
| [`convert_url`](docs/tools/convert-url.md) | Same engines as `convert_file`, plus optional [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) fetcher for Cloudflare / WAF-walled URLs. |
| [`chunk_semantic`](docs/tools/chunk-semantic.md) | [sentence-transformers](https://www.sbert.net/) + LangChain's `SemanticChunker`. |
| [`chunk_late`](docs/tools/chunk-late.md) | [jina-embeddings-v3](https://huggingface.co/jinaai/jina-embeddings-v3) for true late-chunking — document-wide context preserved in every chunk's embedding. |
| [`sanitize_text`](docs/tools/sanitize-text.md) | [Microsoft Presidio](https://microsoft.github.io/presidio/) — PII detection + redaction. |
| [`extract_structured`](docs/tools/extract-structured.md) | [Instructor](https://python.useinstructor.com/) + any OpenAI-compatible LLM endpoint. |
| [`rerank`](docs/tools/rerank.md) | Cohere-compatible cross-encoder reranker ([Infinity](https://github.com/michaelfeil/infinity) / HF TEI). Recommended model: [`BAAI/bge-reranker-v2-m3`](https://huggingface.co/BAAI/bge-reranker-v2-m3). |
| [`classify_domain`](docs/tools/classify-domain.md) | Fixed-taxonomy sequence classifier. Recommended model: [`argilla/ModernBERT-domain-classifier`](https://huggingface.co/argilla/ModernBERT-domain-classifier) (26 domains). |
| [`detect_intent`](docs/tools/detect-intent.md) | Zero-shot span / intent / entity extractor via [GLiNER](https://github.com/urchade/GLiNER). Caller supplies label names per call. Recommended model: [`knowledgator/modern-gliner-bi-large-v1.0`](https://huggingface.co/knowledgator/modern-gliner-bi-large-v1.0). |

## Quickstart

```bash
git clone https://github.com/cvanschalkwijk/toolkit ~/workspace/toolkit
cd ~/workspace/toolkit
cp .env.example .env      # edit LLM_* vars if you want extract_structured
docker compose up -d
```

Two optional compose profiles add backends used by specific tools:

```bash
# SearXNG metasearch backend for `web_search`:
export SEARXNG_SECRET=$(openssl rand -hex 32)    # or set it in .env
docker compose --profile search up -d

# FlareSolverr (headful Chromium) so `convert_url` with
# fetcher="stealth" can get past Cloudflare / WAF challenges:
docker compose --profile stealth up -d

# Both together:
docker compose --profile search --profile stealth up -d
```

SearXNG's debug UI is at <http://localhost:8080>; FlareSolverr's API is at <http://127.0.0.1:8191/v1>. Both bind loopback-only by default.

Then:

- Swagger UI: <http://localhost:3000/>
- OpenAPI spec: <http://localhost:3000/openapi.json>
- MCP endpoint: `http://localhost:3000/mcp`

## Direct HTTP usage

Every tool is a plain POST endpoint. Call it from anything that speaks HTTP — shell scripts, cron jobs, Lambda functions, server code in any language. No agent runtime required.

```bash
curl -sS -X POST http://localhost:3000/web/search \
  -H 'content-type: application/json' \
  -d '{"query":"3D printed sustainable housing breakthroughs","max_results":5}'
```

Swagger UI at `/` shows every endpoint and lets you "Try it out" inline. See each tool's doc for shell + language examples.

## Use it from an agent

### Mastra (TypeScript)

[Mastra](https://mastra.ai/) treats MCP as a first-class citizen — point its `MCPClient` at the toolkit URL and every tool is available to the agent with no per-tool wiring:

```ts
import { Agent } from '@mastra/core/agent'
import { MCPClient } from '@mastra/mcp'

const toolkit = new MCPClient({ url: 'http://localhost:3000/mcp' })

export const researcher = new Agent({
  id: 'research-librarian',
  name: 'Librarian',
  model: 'openai/gpt-4o', // or a local model served via OpenAI-compatible endpoint
  instructions: `
    You turn a broad topic into a structured research briefing.

    1. Use web_search to find the three most authoritative sources on the topic.
    2. For each source, convert it to clean markdown with convert_url
       (for articles and PDFs) or convert_file (for uploaded bytes).
    3. Strip PII from every source with sanitize_text before further processing.
    4. Break the combined text into thematic chunks with chunk_semantic so
       you can reason over sections without blowing the context window.
    5. Return a final structured JSON briefing with extract_structured.
  `,
  tools: await toolkit.getTools(),
})
```

### Any MCP-aware client

The endpoint is just a URL:

```
http://localhost:3000/mcp
```

Works with Mastra, the OpenAI Agents SDK, LangGraph's MCP adapter, [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), `ai` SDK, or anything else that speaks MCP over HTTP/SSE. The same tool registry, same input/output schemas, same behavior as the HTTP surface.

## Showcase: the Digital Research Librarian

A concrete multi-step agent that exercises every category in the toolkit. Given a topic — say, *"The latest breakthroughs in 3D-printed sustainable housing"* — it produces a clean, structured JSON briefing by chaining the tools into a refinery pipeline:

1. **Discover** (`web_search`) — find three authoritative sources (a whitepaper PDF, a technical news article, a video).
2. **Ingest** (`convert_url`) — fetch and convert each source to clean markdown; docling handles the PDF's tables and headings, markitdown the HTML article. When a site returns a Cloudflare challenge instead of content, the agent retries with `fetcher: "stealth"` and FlareSolverr drives a real browser through the challenge.
3. **Sanitize** (`sanitize_text`) — strip researcher emails, incidental PII, anything identifying before the content enters the downstream steps.
4. **Chunk** (`chunk_semantic`) — split the combined markdown into thematic sections ("Materials Science," "Architectural Efficiency," "Cost Analysis") so the LLM reasons over each without context bloat.
5. **Extract** (`extract_structured`) — produce a JSON research card that a database or downstream pipeline can consume:

   ```json
   {
     "topic": "3D-Printed Sustainable Housing",
     "key_innovations": ["Bio-polymer ink", "Robot-arm precision"],
     "primary_experts": ["Dr. Aris", "Team Terra"],
     "summary": "A 500-word executive brief..."
   }
   ```

Each step is one tool call. The agent (Mastra snippet above) orchestrates them based on its instructions. No custom Python, no glue code — the toolkit's tools + an LLM are the whole stack.

This pattern generalizes: swap search → ingest → sanitize → chunk → extract for any refinery workflow (competitive intel, regulatory filings, scientific papers, interview transcripts, …). The building blocks stay the same.

## Adding a tool

See [`docs/ADDING_A_TOOL.md`](docs/ADDING_A_TOOL.md). Short version:

1. Create `apps/api/src/tools/<category>/<name>.ts` exporting a `defineTool({...})` call.
2. Register it in `apps/api/src/tools/<category>/index.ts`.
3. If the tool needs Python libraries, add a backend module under `apps/py/src/toolkit_py/<category>/` and an endpoint in `apps/py/src/toolkit_py/main.py`.
4. Write `apps/api/src/tools/<category>/<name>.test.ts`.

Both the HTTP route and the MCP tool appear automatically on next start.

## Deployment

The repo is hostname-agnostic: any HTTPS reverse proxy that can route to the `api` container works. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a worked example (Caddy + Tailscale + Cloudflare DNS-01); Traefik, Nginx, a Cloudflare Tunnel, or `ngrok` all work equally well.

## License

MIT.
