# toolkit — AI assistant rules

> This file is `AGENTS.md`, the emerging cross-tool convention for agentic
> coding assistants (Codex, Cursor, etc). `CLAUDE.md` is symlinked to it
> so Claude Code picks it up too. Edit either path; they are the same file.

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

## Commits

**Use Conventional Commits.** Required for every commit that lands on
`main` (or any PR targeting it).

Format:

```
<type>(<scope>): <summary>

<optional body — what changed + why, one concept per paragraph>

<optional footer — BREAKING CHANGE, refs, etc.>
```

**Types** (use these verbatim; pick the most specific one):

| Type | Use for |
|---|---|
| `feat` | new user-facing behaviour — a new tool, a new endpoint, a new config knob |
| `fix` | bug fix (runtime, not a typo) |
| `docs` | documentation-only change |
| `chore` | repo/tooling changes with no user-facing behaviour (bumps, scaffolding, renames) |
| `refactor` | code restructure with no behaviour change |
| `perf` | performance-focused change with no other behaviour impact |
| `test` | adding or editing tests only |
| `ci` | CI/workflow/GitHub Actions changes |
| `build` | Dockerfile, packaging, dependency-manifest changes |
| `style` | formatting / whitespace only (Biome autofix, prettier, etc.) |

**Scope** (optional but encouraged) — which part of the repo this touches.
Common scopes: `api`, `py`, `convert`, `chunk`, `sanitize`, `extract`,
`mcp`, `http`, `docs`, `ci`, `deps`.

**Examples:**

```
feat(chunk): add chunk_semantic tool with LangChain SemanticChunker
fix(mcp): use fresh transport per request in stateless mode
docs(tools): document convert_file base64 payload shape
chore: rename CLAUDE.md to AGENTS.md
ci(py): path-filter per category so only changed stacks test
```

**Split commits by concern.** One logical change per commit:

- Good: `feat(convert): add convert_file tool` → `feat(convert): add convert_url tool` → `docs(convert): add per-tool docs` (three commits).
- Bad: one `Phase 3` commit that adds two tools, updates CI, and rewrites the README.

The rule of thumb: if the body of your commit message wants to use the word "also", that's a signal you should split.

Exceptions (OK to bundle): format-only sweeps after a refactor, dependency
bumps that require a coordinated config update, and bootstrap commits that
have no meaningful smaller unit.

**When unsure**, run `git log --oneline origin/main..HEAD` before pushing
and read your own history like a changelog. If a reader would ask "what
was the motivation for mixing these?", split it.

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

- Hostnames. Use `localhost:3000` or `<your-host>` in docs; don't bake a
  specific deployment's domain into the repo.
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
