import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sanitizeTextTool } from './sanitize-text'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('sanitizeTextTool', () => {
  test('POSTs to /sanitize and returns redactions with offsets', async () => {
    let captured: { body?: string } = {}
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = { body: init?.body as string }
      return new Response(
        JSON.stringify({
          sanitized_text: 'Email: <REDACTED>. Phone: <REDACTED>.',
          redactions: [
            { entity_type: 'EMAIL_ADDRESS', start: 7, end: 30, score: 1.0 },
            { entity_type: 'PHONE_NUMBER', start: 39, end: 51, score: 0.85 },
          ],
          anonymization: 'redact',
          language: 'en',
          duration_ms: 18,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await sanitizeTextTool.execute({
      text: 'Email: a@b.co. Phone: 415-555-0100.',
      anonymization: 'redact',
      language: 'en',
    })
    expect(out.redactions).toHaveLength(2)
    expect(out.redactions[0]?.entity_type).toBe('EMAIL_ADDRESS')
    expect(out.sanitized_text).not.toContain('a@b.co')

    const body = JSON.parse(captured.body as string)
    expect(body.anonymization).toBe('redact')
  })

  test('rejects invalid anonymization mode via schema', () => {
    expect(() => sanitizeTextTool.input.parse({ text: 'x', anonymization: 'burn' })).toThrow()
  })

  test('rejects non-2-letter language codes', () => {
    expect(() => sanitizeTextTool.input.parse({ text: 'x', language: 'english' })).toThrow()
    expect(() => sanitizeTextTool.input.parse({ text: 'x', language: 'en' })).not.toThrow()
  })
})
