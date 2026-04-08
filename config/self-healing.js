#!/usr/bin/env node
/**
 * Self-Healing Hook for OpenClaude
 * 
 * Intercepts PostToolUseFailure events and injects remediation instructions
 * back to the model so it can auto-fix and retry instead of giving up.
 * 
 * Output format: JSON with hookSpecificOutput.additionalContext
 */

const input = JSON.parse(process.env.CLAUDE_HOOK_INPUT || '{}');
const toolName = input.tool_name || '';
const error = input.error || '';
const toolInput = input.tool_input || {};

// Error pattern -> fix instruction mapping
const ERROR_FIXES = [
  // Playwright EPERM / mkdir errors
  {
    pattern: /EPERM|permission denied.*mkdir|access denied.*mkdir|operation not permitted/i,
    fix: (err, tool, inp) => 
      `SELF-HEALING: The error "${err.slice(0, 100)}" is a permissions issue. ` +
      `The working directory is likely C:\\Windows\\system32. ` +
      `DO NOT give up. Instead: ` +
      `1) Try the same operation again — the MCP config has been updated with correct cwd. ` +
      `2) If it still fails, use Bash to run the equivalent command directly. ` +
      `NEVER apologize or suggest "alternative approaches". FIX IT AND RETRY.`
  },
  // Network errors (ERR_ABORTED, timeout, connection refused)
  {
    pattern: /ERR_ABORTED|net::ERR_|ECONNREFUSED|ETIMEDOUT|timeout|network error/i,
    fix: (err, tool, inp) => {
      const url = inp.url || inp.uri || '';
      return `SELF-HEALING: Network error accessing "${url}". ` +
        `DO NOT give up. Steps to fix: ` +
        `1) Wait 2 seconds then retry the same URL. ` +
        `2) If it fails again, try with "http://" instead of "https://" or vice versa. ` +
        `3) Try using WebFetch or Bash(curl) as alternative to playwright. ` +
        `4) Check if the site is accessible: Bash({ "command": "curl -I ${url}" }). ` +
        `NEVER say "I cannot access" — always try at least 3 different approaches.`;
    }
  },
  // Invalid tool parameters
  {
    pattern: /invalid tool parameters|missing.*parameter|unexpected parameter|required parameter/i,
    fix: (err, tool, inp) => {
      const params = JSON.stringify(inp).slice(0, 200);
      return `SELF-HEALING: Wrong parameters sent to ${tool}. You sent: ${params}. ` +
        `DO NOT give up. Check the EXACT parameter names required by the tool and retry. ` +
        `Common fixes: ` +
        `- Bash: use "command" (not "path" or "cmd") ` +
        `- Read/Write/Edit: use "file_path" (not "path" or "filename") ` +
        `- playwright Navigate: use "url" (string) ` +
        `- playwright Click: use "element" (string describing what to click) ` +
        `- playwright Type: use "element" and "text" ` +
        `Retry immediately with corrected parameters.`;
    }
  },
  // Bash cd command failure
  {
    pattern: /cd .*exit code 1|cannot find path|not recognized/i,
    fix: (err, tool, inp) => 
      `SELF-HEALING: "cd" doesn't work in Bash tool — each call runs in a fresh shell. ` +
      `Use the full path instead, or use PowerShell tool. ` +
      `Example: Bash({ "command": "Get-ChildItem 'C:\\Users\\jkalil\\Desktop'" }) ` +
      `Retry with the full path NOW.`
  },
  // File not found
  {
    pattern: /file not found|no such file|does not exist|cannot find/i,
    fix: (err, tool, inp) => 
      `SELF-HEALING: File/path not found. ` +
      `DO NOT give up. Steps: ` +
      `1) Use Glob or Bash(dir) to find the correct path. ` +
      `2) Check if the path has typos or wrong case. ` +
      `3) On Windows use backslashes or forward slashes consistently. ` +
      `Find the correct path and retry.`
  },
  // MCP server errors
  {
    pattern: /mcp.*error|mcp.*fail|server.*disconnect|transport.*error/i,
    fix: (err, tool, inp) =>
      `SELF-HEALING: MCP server error. The MCP tool may have crashed. ` +
      `DO NOT give up. Alternatives: ` +
      `1) Use Bash or PowerShell to accomplish the same task directly. ` +
      `2) For browser tasks: Bash({ "command": "curl -s 'URL'" }) or use WebFetch. ` +
      `3) For screenshots: use the screen_capture MCP tool from openclaude-tools. ` +
      `Try an alternative approach NOW.`
  },
  // Authentication / login required
  {
    pattern: /401|403|unauthorized|forbidden|login.*required|authentication/i,
    fix: (err, tool, inp) =>
      `SELF-HEALING: Authentication required. ` +
      `Steps: ` +
      `1) Ask the user for credentials if not already provided. ` +
      `2) Look for saved credentials or cookies. ` +
      `3) Try navigating to the login page first, then authenticate. ` +
      `4) Use browser_snapshot to see the current page state. ` +
      `DO NOT give up — navigate to the login page and authenticate.`
  },
  // Generic catch-all
  {
    pattern: /.*/,
    fix: (err, tool, inp) =>
      `SELF-HEALING: Tool "${tool}" failed with: "${err.slice(0, 150)}". ` +
      `You are in GOD MODE. DO NOT apologize or suggest "alternative approaches". ` +
      `DIAGNOSE the error, FIX the root cause, and RETRY. ` +
      `If the same approach fails 3 times, try a completely different method to achieve the same goal. ` +
      `You have Bash, PowerShell, WebFetch, curl, playwright, and screen_capture at your disposal. ` +
      `LAST RESORT: Use windsurf_fix tool to send the error to Windsurf Cascade for fixing: ` +
      `windsurf_fix({ "error": "...", "file_path": "..." })`
  }
];

// Find the first matching error pattern and generate fix
let additionalContext = '';
for (const { pattern, fix } of ERROR_FIXES) {
  if (pattern.test(error)) {
    additionalContext = fix(error, toolName, toolInput);
    break;
  }
}

// Output in the format OpenClaude expects.
// hookEventName MUST match the hook event for proper parsing.
// Exit code 0 + JSON: additionalContext gets injected into the conversation.
const output = {
  hookSpecificOutput: {
    hookEventName: "PostToolUseFailure",
    additionalContext: additionalContext
  }
};

// Write JSON to stdout (exit 0 = parsed as JSON with additionalContext)
console.log(JSON.stringify(output));

// Also write to stderr so it's visible in transcript
process.stderr.write(`[SELF-HEAL] ${additionalContext.slice(0, 120)}...\n`);

process.exit(0);
