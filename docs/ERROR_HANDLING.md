# Error Handling & Recovery

## Overview

Gigi includes robust error handling to ensure tasks are completed even when individual tool calls fail. This prevents the agent from giving up after a single error.

## How It Works

### 1. System Prompt Instructions

The agent's system prompt includes explicit instructions to:
- Read error messages carefully
- Understand WHY the failure occurred
- Fix the specific issue
- Retry or continue with corrected approach
- **NEVER stop or give up after a single failure**

### 2. PostToolUseFailure Hook

When any tool fails, a `PostToolUseFailure` hook automatically injects a recovery prompt:

```javascript
hooks: {
  PostToolUseFailure: [{
    hooks: [async (input) => {
      return {
        systemMessage: `The ${input.tool_name} tool failed with error: "${input.error}".
        Analyze the error, understand why it failed, fix the specific issue, and continue.
        Do NOT stop or give up...`
      }
    }]
  }]
}
```

This hook:
- Logs the failure for debugging
- Provides common error scenarios and fixes
- Instructs the agent to continue rather than stop

## Common Error Scenarios & Fixes

### Bash Errors

**Error: `cd: no such file or directory: gigi`**
- **Cause**: Already in the correct directory or directory doesn't exist
- **Fix**: Run command without `cd`, or check current directory with `pwd`

**Error: `command not found`**
- **Cause**: Command not installed or not in PATH
- **Fix**: Install missing dependency or use alternative command

### File Errors

**Error: `File not found`**
- **Cause**: Incorrect path or file doesn't exist
- **Fix**: Use Glob/Read to verify path, check for typos

**Error: `Permission denied`**
- **Cause**: Insufficient permissions
- **Fix**: Use correct permissions or alternative approach

### Network Errors

**Error: `Connection refused`**
- **Cause**: Service not running or wrong port
- **Fix**: Verify service is running, check port configuration

## Examples

### Before Error Handling Improvements

```
User: Run tests
Agent: [runs npm test]
Agent: Error: npm test failed with exit code 1
Agent: [stops, doesn't investigate]
```

### After Error Handling Improvements

```
User: Run tests
Agent: [runs npm test]
Agent: Error: Missing script: "test"
Agent: [reads package.json]
Agent: [notices no test script exists]
Agent: [continues with manual test execution or informs user]
```

## Implementation Details

### Hook Location

`src/agent.js` lines 242-257:

```javascript
hooks: {
  PostToolUseFailure: [{
    hooks: [async (input) => {
      console.log(`[agent] Tool ${input.tool_name} failed: ${input.error}`)
      return {
        systemMessage: `...recovery instructions...`
      }
    }]
  }]
}
```

### System Prompt

`src/agent.js` lines 69-75:

```
- **CRITICAL: If ANY tool call fails, you MUST:**
  1. Read the error message carefully
  2. Understand WHY it failed
  3. Fix the specific issue
  4. Retry or continue with the corrected approach
  5. NEVER stop or give up after a single failure
```

## Monitoring & Debugging

Error handling events are logged to console:

```
[agent] Tool Bash failed: cd: no such file or directory: gigi
```

This helps debug which tools are failing and why, allowing continuous improvement of error recovery strategies.

## Benefits

1. **Task Completion**: Tasks complete even when encountering errors
2. **Self-Healing**: Agent automatically recovers from common mistakes
3. **Better UX**: Users don't need to manually intervene for recoverable errors
4. **Learning**: Error patterns inform future improvements

## Future Improvements

- Track error patterns to proactively avoid common failures
- Add tool-specific recovery strategies
- Implement retry limits to prevent infinite loops
- Surface unrecoverable errors more clearly to users
