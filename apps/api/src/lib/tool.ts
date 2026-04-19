/**
 * Tool definition shape. Each tool file in src/tools/ exports a single
 * `defineTool(...)` call. The HTTP and MCP adapters read the same object
 * and light up both interfaces from it.
 *
 * Conventions:
 *   - `name` is snake_case (MCP tool-name convention; used as the function
 *     name LLMs see). Example: 'convert_file', 'chunk_semantic'.
 *   - `category` maps 1:1 to the Swagger tag and the MCP grouping.
 *   - `http.path` starts with '/'. Prefer `/<category>/<subject>` form for
 *     discoverability: '/convert/file', '/sanitize/text'.
 *   - `input` must be a `z.object(...)` (not a primitive or union at the top
 *     level) so the MCP adapter can extract the shape.
 */

import type { z } from '@hono/zod-openapi'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'

export interface ToolHttp {
  method: HttpMethod
  path: `/${string}`
}

export interface Tool<
  I extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  O extends z.ZodType = z.ZodType,
> {
  name: string
  description: string
  category: string
  http: ToolHttp
  input: I
  output: O
  execute: (input: z.infer<I>) => Promise<z.infer<O>>
}

/**
 * Storage shape for heterogeneous tool collections (registries, adapter
 * arguments). Each field is type-erased at the storage boundary so tools
 * with different I/O can share an array. Build via `toStored(...)`.
 */
export interface StoredTool {
  readonly name: string
  readonly description: string
  readonly category: string
  readonly http: ToolHttp
  readonly input: z.ZodObject<z.ZodRawShape>
  readonly output: z.ZodType
  /** Validates the raw input then delegates to the tool's execute. */
  invoke: (raw: unknown) => Promise<unknown>
}

export function defineTool<I extends z.ZodObject<z.ZodRawShape>, O extends z.ZodType>(
  tool: Tool<I, O>,
): Tool<I, O> {
  return tool
}

/**
 * Convert a typed Tool into a StoredTool for heterogeneous storage. The
 * returned object captures the original tool in a closure so calls stay
 * type-checked internally, but the outer shape is erased for the array.
 */
export function toStored<I extends z.ZodObject<z.ZodRawShape>, O extends z.ZodType>(
  tool: Tool<I, O>,
): StoredTool {
  return {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    http: tool.http,
    input: tool.input,
    output: tool.output,
    invoke: async (raw) => tool.execute(tool.input.parse(raw)),
  }
}
