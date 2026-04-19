import { type StoredTool, toStored } from '../lib/tool'
import { pingTool } from './ping'

/**
 * The canonical list of tools exposed over HTTP and MCP. To add a tool:
 *   1. Import the typed Tool.
 *   2. Wrap with `toStored(...)` when adding to this array.
 * See docs/ADDING_A_TOOL.md for the full walkthrough.
 */
export const tools: StoredTool[] = [toStored(pingTool)]
