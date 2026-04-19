import app from './app'
import { env } from './lib/env'

const { API_HOST, API_PORT } = env()

console.log(`toolkit-api listening on ${API_HOST}:${API_PORT}`)

export default {
  port: API_PORT,
  hostname: API_HOST,
  fetch: app.fetch,
}
