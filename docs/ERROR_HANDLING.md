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

### 2. Retry Limit (Max 3 Attempts)

To prevent infinite loops, the error handler tracks failures per tool+input combination:
- **Attempt 1**: Auto-retry with recovery guidance
- **Attempt 2**: Auto-retry with warning that next failure will require help
- **Attempt 3**: Stop retrying, explain the issue to user, ask for guidance

This ensures the agent doesn't waste resources on unrecoverable errors.

### 3. PostToolUseFailure Hook

When any tool fails, a `PostToolUseFailure` hook automatically injects a recovery prompt:

```javascript
// Track failures per tool+input combination
const toolFailures = new Map()

hooks: {
  PostToolUseFailure: [{
    hooks: [async (input) => {
      const failureKey = `${input.tool_name}:${JSON.stringify(input.tool_input)}`
      const retryCount = (toolFailures.get(failureKey) || 0) + 1
      toolFailures.set(failureKey, retryCount)

      // After 3 failures, ask for help
      if (retryCount >= 3) {
        return {
          systemMessage: `Tool has failed ${retryCount} times. Explain the issue to the operator and ask for guidance.`
        }
      }

      // For first 2 failures, provide recovery guidance
      return {
        systemMessage: `Tool failed (attempt ${retryCount}/3). Fix the issue and retry...`
      }
    }]
  }]
}
```

This hook:
- Tracks retry count per unique tool+input combination
- Logs failures with attempt number for debugging
- Provides recovery guidance for first 2 attempts
- After 3 failures, escalates to user for help
- Prevents infinite retry loops on unrecoverable errors

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
Agent: Error: Missing script: "test" (attempt 1/3)
Agent: [reads package.json]
Agent: [notices no test script exists]
Agent: [tries alternative: node --test]
Agent: Error: Invalid flag (attempt 2/3)
Agent: [checks node version]
Agent: [tries: npm run test:unit or searches for test files]
Agent: Error: Still failing (attempt 3/3)
Agent: "I've tried 3 approaches to run tests but they're all failing because:
       1. No 'test' script in package.json
       2. Node version doesn't support --test flag
       3. No test files found
       What testing framework are you using?"
```

## Implementation Details

### Retry Tracking

`src/agent.js` line ~195:

```javascript
// Track tool failures for retry limit (max 3 retries per tool+input combination)
const toolFailures = new Map() // key: `${toolName}:${JSON.stringify(input)}`, value: retry count
```

The key combines tool name and stringified input to track unique failure scenarios. This means:
- Same command failing repeatedly = same retry counter
- Different commands/inputs = separate retry counters
- Prevents exhausting retries on one error from blocking other operations

### Hook Location

`src/agent.js` lines 253-280:

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

Error handling events are logged to console with attempt count:

```
[agent] Tool Bash failed (attempt 1/3): cd: no such file or directory: gigi
[agent] Tool Bash failed (attempt 2/3): cd: no such file or directory: gigi
[agent] Tool Bash failed (attempt 3/3): cd: no such file or directory: gigi
```

This helps:
- Debug which tools are failing and why
- Identify patterns in recurring failures
- Monitor when retry limits are reached
- Inform error recovery strategy improvements

## Benefits

1. **Task Completion**: Tasks complete even when encountering errors
2. **Self-Healing**: Agent automatically recovers from common mistakes
3. **Better UX**: Users don't need to manually intervene for recoverable errors
4. **Prevents Loops**: 3-retry limit prevents infinite retry cycles
5. **Smart Escalation**: Unrecoverable errors escalate to user after retries exhausted
6. **Resource Efficient**: Doesn't waste API calls on hopeless retries
7. **Learning**: Error patterns inform future improvements

## Future Improvements

- Track error patterns across sessions to proactively avoid common failures
- Add tool-specific recovery strategies (custom logic per tool type)
- Persist retry counters across agent restarts
- Exponential backoff for transient failures (network, rate limits)
- Learn from successful recoveries to improve future guidance
