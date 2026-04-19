import { z } from '@hono/zod-openapi'
import { pyJson } from '../../clients/py'
import { defineTool } from '../../lib/tool'

export const sanitizeTextTool = defineTool({
  name: 'sanitize_text',
  description:
    'Detect and redact personally identifiable information (PII) in text — names, emails, phone numbers, SSNs, addresses, etc. Uses Microsoft Presidio (spaCy-powered analyzer + configurable anonymizer). Returns the sanitized text plus a list of redactions with entity types and offsets. Call this BEFORE sending user data to any external LLM. See docs/tools/sanitize-text.md.',
  category: 'sanitize',
  http: { method: 'post', path: '/sanitize/text' },
  input: z
    .object({
      text: z.string().min(1).max(1_000_000),
      entities: z
        .array(z.string())
        .optional()
        .describe(
          'Which PII entity types to redact. If omitted, uses the Presidio default recognizer set (EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD, US_SSN, PERSON, IP_ADDRESS, LOCATION, …).',
        ),
      anonymization: z
        .enum(['redact', 'replace', 'hash', 'mask'])
        .default('redact')
        .describe(
          '`redact`: replace with <REDACTED>. `replace`: replace with <ENTITY_TYPE>. `mask`: overwrite with asterisks. `hash`: replace with SHA-256 hash of the original.',
        ),
      language: z
        .string()
        .length(2)
        .default('en')
        .describe('ISO-639-1 language code. Presidio ships recognizers for several languages.'),
    })
    .openapi('SanitizeTextInput'),
  output: z
    .object({
      sanitized_text: z.string(),
      redactions: z.array(
        z.object({
          entity_type: z.string(),
          start: z.number().int(),
          end: z.number().int(),
          score: z.number(),
        }),
      ),
      anonymization: z.enum(['redact', 'replace', 'hash', 'mask']),
      language: z.string(),
      duration_ms: z.number().int(),
    })
    .openapi('SanitizeTextOutput'),
  execute: async (input) => pyJson('/sanitize', input, { timeoutMs: 60_000 }),
})
