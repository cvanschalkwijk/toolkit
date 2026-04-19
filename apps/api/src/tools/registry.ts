import { type StoredTool, toStored } from '../lib/tool'
import { chunkLateTool, chunkSemanticTool } from './chunk'
import { convertFileTool, convertUrlTool } from './convert'
import { extractStructuredTool } from './extract'
import { pingTool } from './ping'
import { sanitizeTextTool } from './sanitize'

/**
 * The canonical list of tools exposed over HTTP and MCP. To add a tool:
 *   1. Import the typed Tool.
 *   2. Wrap with `toStored(...)` when adding to this array.
 * See docs/ADDING_A_TOOL.md for the full walkthrough.
 */
export const tools: StoredTool[] = [
  toStored(pingTool),
  toStored(convertFileTool),
  toStored(convertUrlTool),
  toStored(chunkSemanticTool),
  toStored(chunkLateTool),
  toStored(sanitizeTextTool),
  toStored(extractStructuredTool),
]
