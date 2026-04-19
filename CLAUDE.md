# toolkit — assistant rules

This repo is a **dual-interface utility API**. Every tool is exposed over
both HTTP (OpenAPI + Swagger) and MCP (SSE) from a single tool registry.
Adding a tool is one small file. The repo is generic — no operator
hostnames, no specific tailnet IPs, no customer references in code or CI.

## Contract

**Every tool must be exposed via BOTH HTTP and MCP.** If a tool is only
useful in one interface, it doesn't belong here. The point of this project
is the dual-interface pattern.

**Tools are plain TypeScript functions.** They have a zod input schema,
zod output schema, and an async `execute(input)` handler. No framework
magic beyond that.

**Python is an implementation detail.** If a tool needs Python libraries
(conversion, ML models, Presidio, etc.), the Python code lives in
`apps/py/`; the Bun tool calls it via HTTP. Never import Python into Bun;
never call Bun from Python.

## Adding a tool

1. Create `apps/api/src/tools/<category>/<name>.ts`. Export a
   `defineTool(...)` call.
2. Re-export it from `apps/api/src/tools/<category>/index.ts`.
3. If the tool needs Python:
   - Add a module under `apps/py/src/toolkit_py/<category>/`.
   - Add an endpoint in `apps/py/src/toolkit_py/main.py`.
   - Add pytest coverage under `apps/py/tests/`.
4. Write `apps/api/src/tools/<category>/<name>.test.ts`. Mock the Python
   sidecar's HTTP; don't boot docker for Bun unit tests.
5. Run the full validate suite before committing. Never push a partial
   validate — CI runs everything, so local must too.

## Testing

- **Bun unit tests** — `bun test apps/api`. Must pass in isolation (no
  Python sidecar, no network). Adapter behavior + tool I/O contract only.
- **Python integration tests** — `pytest` inside the python container or
  a local venv. Real fixture docs through real engines (convert, chunk,
  sanitize). Extract uses a mocked LLM.
- **End-to-end** — `docker compose up -d` then curl the published routes.
  Not in CI yet; done manually when shipping a new tool.

## Style

- Biome is the formatter/linter. `bun run lint:fix` before committing.
- No comments that restate what the code does. Comments are for non-obvious
  *why* — invariants, constraints, external-spec references.
- Tools must have a `description` that an LLM can understand and act on.
  Think about what Claude would need to choose this tool over another one.

## What doesn't go here

- Hostnames (`util.scrannr.com`, `localhost:3000` in docs only as examples).
- Operator infra (Caddyfiles, Cloudflare tokens, SSH keys). That lives in
  the operator's own infra repo; this repo only publishes Docker images and
  a generic `docker-compose.yml`.
- Real secrets. `.env` is gitignored; `.env.example` documents what vars
  exist.
- Data (converted output caches, model weights, downloaded PDFs). All of
  that is runtime-only; use volumes if you need persistence.

## References

- `docs/ADDING_A_TOOL.md` — canonical tool-add walkthrough
- `docs/DEPLOYMENT.md` — one worked deployment (author's setup)
- [Hono zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
