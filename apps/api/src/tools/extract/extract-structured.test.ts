import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { extractStructuredTool } from './extract-structured'

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.PY_URL = 'http://sidecar.test:8000'
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('extractStructuredTool', () => {
  test('POSTs text + schema to /extract/structured and parses reply', async () => {
    let captured: { body?: string; url?: string } = {}
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, body: init?.body as string }
      return new Response(
        JSON.stringify({
          data: { name: 'Ada Lovelace', occupation: 'mathematician', birth_year: 1815 },
          model_used: 'mock-gpt',
          max_retries: 2,
          duration_ms: 412,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = await extractStructuredTool.execute({
      text: 'Ada Lovelace was a mathematician born in 1815.',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          occupation: { type: 'string' },
          birth_year: { type: 'integer' },
        },
        required: ['name', 'occupation', 'birth_year'],
      },
      max_retries: 2,
      temperature: 0.1,
    })

    expect(out.data).toEqual({
      name: 'Ada Lovelace',
      occupation: 'mathematician',
      birth_year: 1815,
    })
    expect(out.model_used).toBe('mock-gpt')
    expect(captured.url).toBe('http://sidecar.test:8000/extract/structured')
    const body = JSON.parse(captured.body as string)
    expect(body.schema.properties.name.type).toBe('string')
  })

  test('surfaces 501 (LLM not configured) as PyError', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          detail: {
            message: 'LLM_BASE_URL is not configured.',
            category: 'extract',
          },
        }),
        { status: 501 },
      )) as unknown as typeof fetch

    await expect(
      extractStructuredTool.execute({
        text: 'hi',
        schema: { type: 'object', properties: { x: { type: 'string' } } },
        max_retries: 2,
        temperature: 0.1,
      }),
    ).rejects.toMatchObject({
      name: 'PyError',
      status: 501,
    })
  })

  test('rejects non-object schemas at the input boundary', () => {
    // zod's `record` requires an object-like value; an array schema still
    // parses as an object in JSON but we document the contract as object-typed.
    expect(() =>
      extractStructuredTool.input.parse({
        text: 'x',
        schema: 'not-an-object',
      }),
    ).toThrow()
  })
})
