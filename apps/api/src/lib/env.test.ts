import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// env() caches — we bust it by reimporting via a fresh URL per test.
// (Bun's test loader won't re-import otherwise.)
async function freshEnv(overrides: Record<string, string | undefined>) {
  const snapshot = { ...process.env }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const mod = await import(`./env.ts?${Date.now()}-${Math.random()}`)
    return mod.env()
  } finally {
    // Restore
    for (const k of Object.keys(overrides)) {
      if (k in snapshot) process.env[k] = snapshot[k]
      else delete process.env[k]
    }
  }
}

describe('env()', () => {
  let saved: NodeJS.ProcessEnv
  beforeEach(() => {
    saved = { ...process.env }
  })
  afterEach(() => {
    // Restore a clean env between tests.
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k]
    }
    for (const [k, v] of Object.entries(saved)) {
      process.env[k] = v
    }
  })

  test('uses documented defaults when nothing is set', async () => {
    const e = await freshEnv({
      API_HOST: undefined,
      API_PORT: undefined,
      PY_URL: undefined,
      LOG_LEVEL: undefined,
      LLM_BASE_URL: undefined,
      LLM_API_KEY: undefined,
      LLM_DEFAULT_MODEL: undefined,
    })
    expect(e.API_HOST).toBe('0.0.0.0')
    expect(e.API_PORT).toBe(3000)
    expect(e.PY_URL).toBe('http://py:8000')
    expect(e.LOG_LEVEL).toBe('info')
    expect(e.LLM_BASE_URL).toBeUndefined()
  })

  test('coerces API_PORT to a number', async () => {
    const e = await freshEnv({ API_PORT: '8080' })
    expect(e.API_PORT).toBe(8080)
  })

  test('accepts empty LLM_BASE_URL as undefined', async () => {
    const e = await freshEnv({ LLM_BASE_URL: '' })
    expect(e.LLM_BASE_URL).toBeUndefined()
  })

  test('accepts a valid LLM_BASE_URL', async () => {
    const e = await freshEnv({
      LLM_BASE_URL: 'https://api.openai.com/v1',
      LLM_API_KEY: 'sk-test',
      LLM_DEFAULT_MODEL: 'gpt-4o-mini',
    })
    expect(e.LLM_BASE_URL).toBe('https://api.openai.com/v1')
    expect(e.LLM_API_KEY).toBe('sk-test')
    expect(e.LLM_DEFAULT_MODEL).toBe('gpt-4o-mini')
  })
})
