import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const extractStructuredTool = defineTool({
  name: 'extract_structured',
  description:
    'Extract structured data from unstructured text by giving it a JSON Schema. Uses Instructor + any OpenAI-compatible LLM endpoint to generate output matching the schema, with automatic retries if the LLM produces invalid JSON. ' +
    'BEST PRACTICE: use a FLAT schema — all fields at the top level, prefixed keys (person_name, company_name) instead of nested objects. Small/mid-size models (< 70B) reliably produce flat JSON but often fail on nested objects or arrays-of-objects. Reshape into nested form client-side if needed. ' +
    'Requires LLM_BASE_URL + LLM_API_KEY env on the sidecar; returns 501 otherwise. Full contract: docs/tools/extract-structured.md.',
  category: 'extract',
  http: { method: 'post', path: '/extract/structured' },
  input: z
    .object({
      text: z.string().min(1).max(1_000_000),
      // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is inherently open-ended
      schema: z
        .record(z.any())
        .describe(
          'JSON Schema describing the target shape. Supported: type (primitive / object / array), properties + required, enum, anyOf, oneOf, and [type, "null"] for optional fields.',
        ),
      model: z
        .string()
        .optional()
        .openapi({ example: 'gemma-4-e4b-turboquant' })
        .describe(
          'Override the model ID for this call. Omit or leave blank to use the sidecar env LLM_DEFAULT_MODEL.',
        ),
      system_prompt: z
        .string()
        .optional()
        .openapi({
          example:
            'You extract structured data from text. Return only values explicitly stated in the input.',
        })
        .describe(
          'Override the system prompt. Omit or leave blank to use a safe "extract only what\'s explicit" default.',
        ),
      max_retries: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(2)
        .describe('How many times Instructor should re-prompt if the LLM produces invalid JSON.'),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .default(0.1)
        .describe('LLM sampling temperature. Keep low for extraction tasks.'),
    })
    .openapi('ExtractStructuredInput'),
  output: z
    .object({
      // biome-ignore lint/suspicious/noExplicitAny: output shape is caller-defined via schema
      data: z.record(z.any()),
      model_used: z.string(),
      max_retries: z.number().int(),
      duration_ms: z.number().int(),
    })
    .openapi('ExtractStructuredOutput'),
  execute: async (input) => pyJson('/extract/structured', input, { timeoutMs: 180_000 }),
})
