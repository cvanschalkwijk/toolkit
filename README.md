# toolkit

**HTTP + MCP utility API for LLM-efficient document tooling.**

One service, two interfaces, one source of truth:

- **HTTP** — Hono + OpenAPI, Swagger UI served at `/`. Any client that speaks HTTP can use it.
- **MCP** — Model Context Protocol over HTTP/SSE at `/mcp`. Any MCP-aware LLM agent (Claude Desktop, Cursor, Continue.dev, …) can discover and call the same tools natively.

Adding a tool is a single TypeScript file; it lights up on both interfaces automatically.

## Tools (v1)

Each tool name links to its per-tool doc with full inputs, outputs, and examples.

| Category | Tools | Backend |
|---|---|---|
| **Conversion** | [`convert_file`](docs/tools/convert-file.md), [`convert_url`](docs/tools/convert-url.md) | [markitdown](https://github.com/microsoft/markitdown) + [docling](https://github.com/docling-project/docling) (auto-routed by format) |
| **Chunking** | [`chunk_semantic`](docs/tools/chunk-semantic.md), [`chunk_late`](docs/tools/chunk-late.md) | [sentence-transformers](https://www.sbert.net/) + LangChain `SemanticChunker`; [jina-embeddings-v3](https://huggingface.co/jinaai/jina-embeddings-v3) for true late-chunking |
| **Sanitization** | [`sanitize_text`](docs/tools/sanitize-text.md) | [Microsoft Presidio](https://microsoft.github.io/presidio/) |
| **Structured output** | [`extract_structured`](docs/tools/extract-structured.md) | [Instructor](https://python.useinstructor.com/) + any OpenAI-compatible endpoint |

## Quickstart

```bash
git clone https://github.com/cvanschalkwijk/toolkit ~/workspace/toolkit
cd ~/workspace/toolkit
cp .env.example .env      # edit LLM_* vars if you want extract_structured
docker compose up -d
```

Then:

- Swagger UI: <http://localhost:3000/>
- OpenAPI spec: <http://localhost:3000/openapi.json>
- MCP endpoint: `http://localhost:3000/mcp`

## MCP client config

### Claude Desktop

Append to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "toolkit": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

If your Claude Desktop version doesn't accept bare SSE URLs, use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "toolkit": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

### Cursor

Settings → MCP → Add new MCP Server. URL: `http://localhost:3000/mcp`.

## Adding a tool

See [`docs/ADDING_A_TOOL.md`](docs/ADDING_A_TOOL.md). Short version:

1. Create `apps/api/src/tools/<category>/<name>.ts` exporting a `defineTool({...})` call.
2. Register it in `apps/api/src/tools/<category>/index.ts`.
3. If the tool needs Python libraries, add a backend module under `apps/py/src/toolkit_py/<category>/` and an endpoint in `apps/py/src/toolkit_py/main.py`.
4. Write `apps/api/src/tools/<category>/<name>.test.ts`.

Both the HTTP route and the MCP tool appear automatically on next start.

## Deployment

The repo is hostname-agnostic: any HTTPS reverse proxy that can route to
the `api` container works. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
for a worked example (Caddy + Tailscale + Cloudflare DNS-01); Traefik,
Nginx, a Cloudflare Tunnel, or `ngrok` all work equally well.

## License

MIT.
