# Adding a tool

Tools are the unit of functionality. Adding one:

1. Creates an HTTP route under `/<category>/<path>` with auto-generated OpenAPI docs.
2. Registers a function with the MCP server under its `snake_case` name.

Both happen from a single TypeScript file.

## 1. Write the tool

Create `apps/api/src/tools/<category>/<your-tool>.ts`:

```typescript
import { z } from '@hono/zod-openapi'
import { defineTool } from '../../lib/tool'

export const reverseTextTool = defineTool({
  // MCP tool name — snake_case by convention. This is what LLMs see.
  name: 'reverse_text',

  // LLM-readable description. Be specific about WHAT it does and WHEN to use it.
  description:
    'Reverses a string character-by-character. Useful for palindrome detection ' +
    'or decoding simple reversed messages. Unicode-safe.',

  // Swagger tag + MCP grouping. Pick an existing category or add a new one.
  category: 'text',

  // HTTP route. Use `/<category>/<subject>` for discoverability.
  http: { method: 'post', path: '/text/reverse' },

  input: z
    .object({
      text: z.string().min(1).max(10_000).describe('The string to reverse.'),
    })
    .openapi('ReverseTextInput'),

  output: z
    .object({
      reversed: z.string(),
      length: z.number().int(),
    })
    .openapi('ReverseTextOutput'),

  execute: async ({ text }) => {
    // Unicode-aware reverse: split by grapheme cluster, not code unit.
    const reversed = [...new Intl.Segmenter().segment(text)].map((s) => s.segment).reverse().join('')
    return { reversed, length: [...text].length }
  },
})
```

**Rules for the schema:**

- `input` MUST be a `z.object(...)` (not a primitive or union at the top level).
  The MCP adapter extracts the `.shape` to build the tool-call schema.
- Use `.describe(...)` on every field. MCP clients show these to the LLM.
- Use `.openapi('SomeName')` on top-level schemas so Swagger UI labels them nicely.
- Put bounds on everything. `z.string().max(10_000)` prevents a runaway
  payload from eating the server's memory.

## 2. Register it in the category index

Create or edit `apps/api/src/tools/<category>/index.ts`:

```typescript
export { reverseTextTool } from './reverse-text'
```

## 3. Add to the global registry

Edit `apps/api/src/tools/registry.ts`:

```typescript
import { reverseTextTool } from './text'

export const tools: Tool<any, any>[] = [pingTool, reverseTextTool]
```

## 4. (Optional) Python backend

If your tool calls a Python library (ML model, Presidio, markitdown, etc.):

1. Add a module under `apps/py/src/toolkit_py/<category>/`. Keep it a pure
   function: inputs in, outputs in, no global state.
2. Register an HTTP endpoint in `apps/py/src/toolkit_py/main.py` that wraps
   the pure function.
3. In your Bun tool's `execute`, `fetch` the sidecar at `${PY_URL}/<path>`.

Keep every sync/blocking Python call inside `asyncio.to_thread` so FastAPI's
event loop stays responsive.

## 5. Write tests

Create `apps/api/src/tools/<category>/<your-tool>.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { reverseTextTool } from './reverse-text'

describe('reverse_text', () => {
  test('reverses ASCII', async () => {
    const result = await reverseTextTool.execute({ text: 'hello' })
    expect(result.reversed).toBe('olleh')
    expect(result.length).toBe(5)
  })

  test('reverses unicode grapheme clusters correctly', async () => {
    const result = await reverseTextTool.execute({ text: 'a👨‍👩‍👧b' })
    expect(result.reversed).toBe('b👨‍👩‍👧a')
  })
})
```

The input/output schemas are tested by the adapter tests. Your tool's test
covers the `execute` logic.

## 6. Run the full suite

```bash
bun run validate
```

This runs typecheck + lint + test across the workspace — the same as CI.
Don't push without it green.

## Conventions cheat sheet

| What | How |
|---|---|
| Tool name (MCP) | `snake_case`, e.g. `reverse_text`, `convert_file` |
| Variable name (TS) | `camelCaseTool`, e.g. `reverseTextTool` |
| Filename | `kebab-case.ts`, e.g. `reverse-text.ts` |
| HTTP path | `/<category>/<subject>`, e.g. `/text/reverse` |
| Category | A single word, lowercased |
| Description | LLM-consumable sentence explaining WHAT + WHEN. 1-3 sentences. |
