import { z } from 'zod'

const schema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PY_URL: z.string().url().default('http://py:8000'),
  // LLM backend only required by the extract_structured tool; empty is OK.
  LLM_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  LLM_API_KEY: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  LLM_DEFAULT_MODEL: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Invalid environment configuration:')
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  cached = parsed.data
  return cached
}
