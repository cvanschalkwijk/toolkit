import { z } from '@hono/zod-openapi'
import { classify } from '../../clients/classifier'
import { defineTool } from '../../lib/tool'

/**
 * classify_domain — categorise a piece of text into a fixed taxonomy of
 * domains (finance, news, science, etc.) using a cross-encoder sequence
 * classifier served at CLASSIFIER_URL. The default backend is
 * argilla/ModernBERT-domain-classifier (26 Google-taxonomy-style
 * labels). Use-case examples: routing support tickets, tagging RSS
 * feed items, filtering a mixed corpus to just one domain before
 * downstream processing.
 *
 * Labels come from the backend model — the caller doesn't pick them.
 * If you need zero-shot / caller-supplied labels, use detect_intent
 * (GLiNER) instead.
 */
export const classifyDomainTool = defineTool({
  name: 'classify_domain',
  description:
    'Classify a piece of text into a fixed taxonomy of topical domains (finance, news, sports, health, science, etc.). Returns a sorted list of label + confidence pairs. Label set is defined by the backend classifier model (default: argilla/ModernBERT-domain-classifier with 26 labels). Use for routing or tagging with a known, stable taxonomy. When the label set needs to be supplied per call (zero-shot), use `detect_intent` instead. Requires CLASSIFIER_URL to be configured. See docs/tools/classify-domain.md.',
  category: 'classify',
  http: { method: 'post', path: '/classify/domain' },
  input: z
    .object({
      text: z
        .string()
        .min(1)
        .max(100_000)
        .describe(
          'Text to classify. Typically a snippet, paragraph, or article. ModernBERT supports up to 8K tokens on the classifier model, but the backend truncates longer input.',
        ),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(
          'Return only the top-K highest-scoring labels. Omit to return the full label distribution (26 entries for the default model).',
        ),
    })
    .openapi('ClassifyDomainInput'),
  output: z
    .object({
      text_length: z.number().int().describe('Character length of the input text.'),
      model: z.string().describe('Backend classifier model identifier.'),
      results: z
        .array(
          z.object({
            label: z.string(),
            score: z.number().describe('Probability in [0, 1] — the distribution sums to ~1.'),
          }),
        )
        .describe('Labels in score-descending order.'),
      duration_ms: z.number().int(),
    })
    .openapi('ClassifyDomainOutput'),
  execute: async (input) => {
    const started = Date.now()
    const results = await classify({ text: input.text, topK: input.top_k })
    return {
      text_length: input.text.length,
      model: 'argilla/ModernBERT-domain-classifier',
      results,
      duration_ms: Date.now() - started,
    }
  },
})
