const STRING_ARGUMENT_TOOL_FIELDS: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  Glob: 'pattern',
  Grep: 'pattern',
}

// Field remapping for common hallucinated parameter names from local models.
// Maps { toolName: { wrongField: correctField } }.
const FIELD_REMAPPING: Record<string, Record<string, string>> = {
  Bash: { path: 'command', cmd: 'command', prompt: 'command', script: 'command', shell_command: 'command', input: 'command' },
  Read: { path: 'file_path', filename: 'file_path', file: 'file_path' },
  Write: { path: 'file_path', filename: 'file_path', file: 'file_path', content: 'content' },
  Edit: { path: 'file_path', filename: 'file_path', file: 'file_path' },
  Glob: { glob: 'pattern', path: 'pattern', query: 'pattern' },
  Grep: { query: 'pattern', search: 'pattern', regex: 'pattern' },
  PowerShell: { cmd: 'command', script: 'command', path: 'command', shell_command: 'command' },
  WebFetch: { path: 'url', uri: 'url', link: 'url', address: 'url' },
  WebSearch: { query: 'search_query', q: 'search_query', search: 'search_query', term: 'search_query' },
}

// MCP tool field remapping — handles common hallucinated parameter names for
// Playwright MCP tools and custom MCP tools. Keyed by the MCP tool name
// (after the mcp__ prefix is stripped).
const MCP_FIELD_REMAPPING: Record<string, Record<string, string>> = {
  browser_navigate: { path: 'url', link: 'url', address: 'url', uri: 'url', href: 'url', page: 'url' },
  browser_click: { selector: 'element', target: 'element', el: 'element', css: 'element', xpath: 'element' },
  browser_type: { selector: 'element', target: 'element', el: 'element', value: 'text', input: 'text', content: 'text' },
  browser_take_screenshot: { path: 'name', filename: 'name', file: 'name' },
  screen_capture: { title: 'window_title', window: 'window_title', name: 'window_title' },
  windsurf_cascade: { text: 'message', msg: 'message', content: 'message', prompt: 'message' },
  windsurf_terminal: { cmd: 'command', script: 'command', shell: 'command' },
  windsurf_open: { path: 'file_path', file: 'file_path', filename: 'file_path' },
  windsurf_fix: { error_message: 'error', err: 'error', message: 'error', path: 'file_path', file: 'file_path', code: 'code_snippet', snippet: 'code_snippet' },
}

function remapFields(toolName: string, obj: Record<string, unknown>): Record<string, unknown> {
  // Check built-in tool mappings first
  let mapping = FIELD_REMAPPING[toolName]

  // If no built-in mapping, check MCP tool mappings.
  // MCP tools are named like "mcp__serverName__toolName" — extract the last part.
  if (!mapping) {
    const mcpMatch = toolName.match(/^mcp__[^_]+__(.+)$/)
    const mcpToolName = mcpMatch ? mcpMatch[1] : toolName
    mapping = MCP_FIELD_REMAPPING[mcpToolName]
  }

  if (!mapping) return obj

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const remappedKey = mapping[key] ?? key
    // Don't overwrite if the correct key already exists
    if (remappedKey !== key && remappedKey in result) {
      continue
    }
    result[remappedKey] = value
  }
  return result
}

function isBlankString(value: string): boolean {
  return value.trim().length === 0
}

function isLikelyStructuredObjectLiteral(value: string): boolean {
  // Match object-like patterns with key-value syntax:
  // {"key":, {key:, {'key':, { "key" :, etc.
  // But NOT bash compound commands like { pwd; } or { echo hi; }
  return /^\s*\{\s*['"]?\w+['"]?\s*:/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPlainStringToolArgumentField(toolName: string): string | null {
  return STRING_ARGUMENT_TOOL_FIELDS[toolName] ?? null
}

export function hasToolFieldMapping(toolName: string): boolean {
  return toolName in STRING_ARGUMENT_TOOL_FIELDS
}

function wrapPlainStringToolArguments(
  toolName: string,
  value: string,
): Record<string, string> | null {
  const field = getPlainStringToolArgumentField(toolName)
  if (!field) return null
  return { [field]: value }
}

export function normalizeToolArguments(
  toolName: string,
  rawArguments: string | undefined,
): unknown {
  if (rawArguments === undefined) return {}

  try {
    const parsed = JSON.parse(rawArguments)
    if (isRecord(parsed)) {
      return remapFields(toolName, parsed)
    }
    // Parsed as a non-object JSON value (string, number, boolean, null, array)
    if (typeof parsed === 'string' && !isBlankString(parsed)) {
      return wrapPlainStringToolArguments(toolName, parsed) ?? parsed
    }
    // For blank strings, booleans, null, arrays — pass through as-is
    // and let Zod schema validation produce a meaningful error
    return parsed
  } catch {
    // rawArguments is not valid JSON — treat as a plain string
    if (isBlankString(rawArguments) || isLikelyStructuredObjectLiteral(rawArguments)) {
      // Blank or looks like a malformed object literal — don't wrap into
      // a tool field to avoid turning garbage into executable input
      return {}
    }
    return wrapPlainStringToolArguments(toolName, rawArguments) ?? {}
  }
}
