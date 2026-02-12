# Task Completion Enforcer

## The Problem (gigi#11)

**Before:** Gigi relied on system prompts to complete tasks. This created a race condition:
- System prompt says "create a PR and notify Mauro"
- Agent might stop mid-task due to context limits, conversation end, or just "forgetting"
- Prompts are **suggestions**, not **enforced contracts**

**Result:** Incomplete tasks, missing PRs, no notifications.

## The Solution

**Enforce completion through code, not prompts.**

The Task Enforcer is a **state machine** that:

1. **Tracks task context** in the database (not just conversation history)
2. **Detects code changes** by comparing workspace snapshots
3. **Auto-triggers follow-up actions** when steps are incomplete
4. **Prevents the agent from stopping mid-task** by injecting continuation prompts

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User Input                        │
│              "Mauro: /issue gigi#11"                 │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           Router (src/router.js)                     │
│  • Detects /issue command → startTask()             │
│  • Runs agent loop                                   │
│  • After response: enforceCompletion()               │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│      Task Enforcer (src/task_enforcer.js)           │
│  • Captures workspace snapshot (git status, hash)   │
│  • After agent response:                             │
│    1. Detect code changes? → inject "create PR"     │
│    2. Detect branch push? → inject "create PR"      │
│    3. PR created? → inject "send notification"      │
│  • Auto-triggers follow-up agent cycles              │
└─────────────────────────────────────────────────────┘
```

## Database Schema

```sql
CREATE TABLE task_context (
  id SERIAL PRIMARY KEY,
  conversation_id UUID,
  repo VARCHAR(100),
  issue_number INT,
  branch VARCHAR(200),
  has_code_changes BOOLEAN DEFAULT false,
  pr_created BOOLEAN DEFAULT false,
  notified BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  workspace_snapshot JSONB,
  UNIQUE(conversation_id, repo, issue_number)
);
```

## State Machine

```
┌──────────────┐
│ Task Started │  ← /issue gigi#11
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Code Changed?    │  ← Detect git hash change or dirty files
└──────┬───────────┘
       │ YES
       ▼
┌──────────────────┐
│ Branch Pushed?   │  ← Detect upstream branch
└──────┬───────────┘
       │ YES
       ▼
┌──────────────────┐
│ PR Created?      │  ← Check task_context.pr_created
└──────┬───────────┘
       │ YES
       ▼
┌──────────────────┐
│ Notified?        │  ← Check task_context.notified
└──────┬───────────┘
       │ YES
       ▼
┌──────────────────┐
│ Task Complete ✅ │
└──────────────────┘
```

**At each state:** If the next step is incomplete, the enforcer **injects a follow-up prompt** to trigger the agent again.

## Example Flow

### Without Enforcer (Old Behavior)
```
User: /issue gigi#11
Gigi: [Reads issue, makes code changes, then STOPS]
User: ??? (no PR, no notification)
```

### With Enforcer (New Behavior)
```
User: /issue gigi#11
Gigi: [Reads issue, makes code changes]

[Enforcer detects code change]
[Enforcer injects: "You made code changes. Create a PR."]

Gigi: [Creates PR via gitea tool]

[Enforcer detects PR created]
[Enforcer injects: "Send Telegram notification."]

Gigi: [Sends notification via telegram_send]

[Enforcer marks task complete]
```

## Key Functions

### `startTask(conversationId, repo, issueNumber)`
- Called when `/issue` command is detected
- Captures workspace snapshot (git status, hash, dirty files)
- Creates/resets task context in DB

### `enforceCompletion(conversationId)`
- Called after every agent response
- Compares current workspace to snapshot
- Returns enforcement action if needed:
  - `code_changed` → inject "create PR" prompt
  - `branch_pushed` → inject "create PR via gitea" prompt
  - `needs_notification` → inject "send Telegram notification" prompt

### `markNotified(conversationId, repo, issueNumber)`
- Marks task as complete
- Sets `completed_at` timestamp

## Benefits

1. **No more incomplete tasks** – Enforcer won't let the agent stop mid-way
2. **No reliance on prompts** – Code enforces the loop, not suggestions
3. **Automatic retry** – If agent "forgets" a step, enforcer triggers it
4. **Audit trail** – Database tracks task state for debugging

## Limitations

1. **Only works for /issue tasks** – General tasks without `/issue` aren't tracked
2. **Workspace detection only** – If code is changed outside `/workspace`, enforcer won't detect it
3. **No rollback** – If PR creation fails, task stays in `pr_created=false` state

## Future Improvements

1. Add enforcer for general tasks (not just `/issue`)
2. Detect PR creation via Gitea API instead of git branch check
3. Add timeout: if task incomplete after 1 hour, notify Mauro
4. Support multi-repo tasks (e.g., changes in `gigi` + `deploy-docker-compose`)

## Design Philosophy

**"Code > Prompts"**

Don't ask the LLM to remember. **Make the system enforce it.**

This is the core principle behind Gigi's reliability.
