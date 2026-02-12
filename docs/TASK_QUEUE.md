# Task Queue System

## Overview

The task queue ensures Gigi completes all work autonomously without getting stuck mid-task.

**Key Design:** Agent declares tasks, but **Supervisor verifies completion**. This prevents incomplete outputs from stalling the queue.

## Architecture

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ "Create PR for issue #10"
       ▼
┌─────────────┐
│   Agent     │──────┐
│  (Gigi)     │      │ addTask("Create PR")
└──────┬──────┘      │
       │             ▼
       │      ┌──────────────┐
       │      │  Task Queue  │
       │      └──────┬───────┘
       │             │
       ▼             ▼
┌─────────────────────────┐
│     Supervisor Loop     │
│                         │
│ 1. Agent stops output   │
│ 2. Check current task   │
│ 3. Prompt: "Complete?"  │
│ 4. Agent confirms       │
│ 5. Complete & continue  │
└─────────────────────────┘
```

## How It Works

### Agent (Gigi) Role:
- Declares tasks via `addTask(...)`
- Works on current task
- Declares follow-up tasks as needed
- Confirms completion when prompted

### Supervisor Role:
- Monitors task queue after each agent response
- Prompts agent to verify task completion
- Removes completed tasks from queue
- Starts next task automatically
- Keeps agent running until queue is empty

## Example Flow

```javascript
// User: "Create a PR for gigi#10"
// Agent declares task:
taskQueue.addTask({ id: 1, description: "Create PR for gigi#10" });

// Supervisor prompts: "Is task 'Create PR for gigi#10' complete?"
// Agent: "Not yet, I need to update README first"
taskQueue.addTask({ id: 2, description: "Update README" });

// Agent: "TASK_COMPLETE: 1" (PR created)
// Supervisor removes task 1, starts task 2

// Supervisor prompts: "Is task 'Update README' complete?"
// Agent: "Not yet, I need to commit changes"
taskQueue.addTask({ id: 3, description: "Commit and push" });

// Agent: "TASK_COMPLETE: 2" (README updated)
// Supervisor removes task 2, starts task 3

// Agent: "TASK_COMPLETE: 3" (Changes pushed)
// Supervisor removes task 3
// Queue is empty → Agent goes idle
```

## Rules for Agent

1. **Declare tasks with `addTask(...)`** - Don't call `completeTask(...)`
2. **Declare follow-up tasks BEFORE confirming completion**
3. **Explicitly confirm completion**: Include `TASK_COMPLETE: <task_id>` in response
4. **The supervisor keeps you running** - Don't worry about going idle mid-task

## API Reference

### TaskQueue

```javascript
const taskQueue = require('./lib/taskQueue');

// Agent declares a task
taskQueue.addTask({
  id: 'unique-task-id',
  description: 'Human-readable description',
  type: 'pr|issue|commit',
  context: { /* additional data */ }
});

// Get current task (used by supervisor)
const currentTask = taskQueue.getCurrentTask();

// Check if queue is empty
const isEmpty = taskQueue.isEmpty();

// Get status
const status = taskQueue.getStatus();
// {
//   currentTaskId: 'task-1',
//   pendingTasks: 2,
//   inProgressTasks: 1,
//   totalTasks: 3,
//   tasks: [...]
// }
```

### Supervisor

```javascript
const supervisor = require('./lib/supervisor');

// Run supervisor loop (called after each agent response)
const result = await supervisor.runLoop(conversationContext, callAgentFunction);

// result = {
//   status: 'idle' | 'in_progress',
//   context: [...], // Updated conversation history
//   currentTask: {...} // If still in progress
// }

// Get status
const status = supervisor.getStatus();
```

## Events

```javascript
taskQueue.on('task_added', (task) => {
  console.log(`New task: ${task.description}`);
});

taskQueue.on('task_started', (task) => {
  console.log(`Started: ${task.description}`);
});

taskQueue.on('task_completed', (task) => {
  console.log(`Completed: ${task.description}`);
});

taskQueue.on('queue_empty', () => {
  console.log('All tasks complete!');
});
```

## Integration with Agent Runtime

The supervisor loop should be integrated into the main agent execution flow:

```javascript
// In agent.js or similar
const supervisor = require('./lib/supervisor');
const taskQueue = require('./lib/taskQueue');

async function handleUserMessage(message, context) {
  // Add user message to context
  context.push({ role: 'user', content: message });

  // Call agent
  const response = await callAgent(context);
  context.push({ role: 'assistant', content: response.content });

  // Run supervisor loop to check task completion
  while (!taskQueue.isEmpty()) {
    const result = await supervisor.runLoop(context, callAgent);
    context = result.context;

    if (result.status === 'idle') {
      break; // All tasks complete
    }
  }

  return context;
}
```

## Why This Design?

**Problem:** If the agent's output gets truncated or incomplete, tasks can stall forever.

**Solution:** The supervisor monitors the queue and actively prompts the agent to verify completion. This ensures:
- Tasks don't stall due to incomplete outputs
- Agent stays alive until all work is done
- Context is preserved throughout the process
- User doesn't need to "reping" to check progress
