import { z } from '@hono/zod-openapi'
import { glinerPredict } from '../../clients/gliner'
import { defineTool } from '../../lib/tool'

/**
 * detect_intent — zero-shot span/entity/intent detection via GLiNER.
 *
 * Caller supplies the candidate labels per call (e.g.
 * ["user_intent", "required_action", "urgency"] for a support ticket;
 * ["person", "company", "date"] for a news article). GLiNER finds
 * spans in the text that match each label, with confidence scores.
 * No fine-tuning required — the model generalises from the label
 * names themselves, so labels should be natural-language phrases
 * not arbitrary IDs.
 *
 * Use for:
 *  - Intent classification on user messages (plus the span that
 *    triggered the intent)
 *  - NER with caller-defined entity types
 *  - Topic spotting in free-form text
 *
 * When labels are stable across calls, prefer classify_domain — it
 * returns a probability distribution across the full taxonomy in a
 * single forward pass, which is cheaper and more reliable than
 * reframing the problem as span extraction.
 */
export const detectIntentTool = defineTool({
  name: 'detect_intent',
  description:
    'Extract spans from text that match caller-supplied labels, zero-shot, via the GLiNER bi-encoder (modern-gliner-bi-large-v1.0). Inputs: the text + an array of label names (natural-language phrases like "user_intent", "required_action", "urgency", "company_name"). Returns the spans that match each label with confidence scores. Best for caller-defined taxonomies — intent detection on support tickets, NER with custom entity types, topic spotting. When the label set is fixed and stable, prefer `classify_domain` (single forward pass, probability distribution, no span boundaries needed). Requires GLINER_URL to be configured. See docs/tools/detect-intent.md.',
  category: 'intent',
  http: { method: 'post', path: '/intent/detect' },
  input: z
    .object({
      text: z
        .string()
        .min(1)
        .max(50_000)
        .describe(
          'Text to extract spans from. ModernBERT-large supports up to 8K tokens but longer inputs truncate at the backend.',
        ),
      labels: z
        .array(z.string().min(1).max(100))
        .min(1)
        .max(50)
        .describe(
          'Candidate labels. Use natural-language phrases — the model generalises from the label names themselves, so "user_intent" or "urgency level" works better than "IT_01". Max 50 per call.',
        ),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe(
          'Minimum confidence to keep a span. Default 0.5 works for most cases; lower (0.2-0.3) when you want recall and are OK filtering client-side.',
        ),
      flat_ner: z
        .boolean()
        .default(true)
        .describe(
          'If true (default), only the top-score non-overlapping spans are returned. Set false to allow nested / overlapping matches (rare).',
        ),
    })
    .openapi('DetectIntentInput'),
  output: z
    .object({
      text_length: z.number().int(),
      model: z.string(),
      entities: z
        .array(
          z.object({
            start: z
              .number()
              .int()
              .describe('Character offset of the span start in the input text.'),
            end: z.number().int().describe('Character offset of the span end (exclusive).'),
            text: z.string().describe('The matched span text.'),
            label: z.string().describe('Which caller-supplied label this span matched.'),
            score: z.number().describe('Confidence in [0, 1].'),
          }),
        )
        .describe(
          'Spans in score-descending order. Empty array when nothing cleared the threshold.',
        ),
      duration_ms: z.number().int(),
    })
    .openapi('DetectIntentOutput'),
  execute: async (input) => {
    const started = Date.now()
    const entities = await glinerPredict({
      text: input.text,
      labels: input.labels,
      threshold: input.threshold,
      flatNer: input.flat_ner,
    })
    return {
      text_length: input.text.length,
      model: 'knowledgator/modern-gliner-bi-large-v1.0',
      entities,
      duration_ms: Date.now() - started,
    }
  },
})
