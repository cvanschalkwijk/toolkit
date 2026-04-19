import { describe, expect, test } from 'bun:test'
import { pingTool } from './ping'

describe('pingTool', () => {
  test('echoes message with pong prefix', async () => {
    const result = await pingTool.execute({ message: 'hello' })
    expect(result.reply).toBe('pong: hello')
  })

  test('returns an ISO-8601 UTC timestamp', async () => {
    const result = await pingTool.execute({ message: 'x' })
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // Parseable as Date and within 5s of now.
    const t = new Date(result.timestamp).getTime()
    expect(Math.abs(Date.now() - t)).toBeLessThan(5000)
  })

  test('handles empty strings', async () => {
    const result = await pingTool.execute({ message: '' })
    expect(result.reply).toBe('pong: ')
  })

  test('handles unicode + emoji', async () => {
    const result = await pingTool.execute({ message: '👋 こんにちは' })
    expect(result.reply).toBe('pong: 👋 こんにちは')
  })

  test('exposes a valid MCP-compatible schema shape', () => {
    expect(pingTool.name).toBe('ping')
    expect(pingTool.name).toMatch(/^[a-z][a-z0-9_]*$/) // MCP snake_case
    expect(pingTool.description.length).toBeGreaterThan(20)
    expect(pingTool.category).toBeTruthy()
    expect(pingTool.http.path.startsWith('/')).toBe(true)
    expect(pingTool.input.shape).toBeDefined()
  })
})
