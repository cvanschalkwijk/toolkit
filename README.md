# toolkit

**HTTP + MCP utility API for LLM-efficient document tooling.**

One service, two interfaces, one source of truth:

- **HTTP** — Hono + OpenAPI, Swagger UI served at `/`. Any client that speaks HTTP can use it.
- **MCP** — Model Context Protocol over HTTP/SSE at `/mcp`. Any MCP-aware LLM agent (Claude Desktop, Cursor, Continue.dev, …) can discover and call the same tools natively.

Adding a tool is a single TypeScript file; it lights up on both interfaces automatically.

## Tools (v1)

| Category | Tools | Backend |
|---|---|---|
| **Conversion** | `convert_file`, `convert_url` | [markitdown](https://github.com/microsoft/markitdown) + [docling](https://github.com/docling-project/docling) (auto-routed by format) |
| **Chunking** | `chunk_semantic`, `chunk_late` | [sentence-transformers](https://www.sbert.net/) + LangChain `SemanticChunker`; [jina-embeddings-v3](https://huggingface.co/jinaai/jina-embeddings-v3) for true late-chunking |
| **Sanitization** | `sanitize_text` | [Microsoft Presidio](https://microsoft.github.io/presidio/) |
| **Structured output** | `extract_structured` | [Instructor](https://python.useinstructor.com/) + any OpenAI-compatible endpoint |

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

For a worked example (Caddy + Tailscale + Cloudflare DNS-01 + bitdream host), see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Any HTTPS reverse proxy that can route to the Bun container works; the repo itself is hostname-agnostic.

## License

MIT.
