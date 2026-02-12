# Supervisor Integration Guide

## Overview

This guide shows how to integrate the supervisor loop into Gigi's agent runtime.

## Architecture

```
User Message
     ↓
┌─────────────────────────┐
│  handleUserMessage()    │
│                         │
│  1. Add msg to context  │
│  2. Call agent (LLM)    │
│  3. Add response        │
│     ↓                   │
│  ┌─────────────────┐   │
│  │ Supervisor Loop │   │
│  │                 │   │
│  │ While queue     │   │
│  │ not empty:      │   │
│  │   Check task    │   │
│  │   Prompt agent  │   │
│  │   Verify done   │   │
│  │   Complete      │   │
│  │   Start next    │   │
│  └─────────────────┘   │
└─────────────────────────┘
     ↓
Response to User
```

## Integration Code

### Option 1: WebSocket Handler (Current Setup)

```javascript
// In src/routes/chat.js or similar

const supervisor = require('../lib/supervisor');
const taskQueue = require('../lib/taskQueue');

// Make taskQueue available to agent
global.taskQueue = taskQueue;

io.on('connection', (socket) => {
  socket.on('message', async (msg) => {
    const context = getOrCreateContext(socket.id);

    // Add user message
    context.push({ role: 'user', content: msg });

    // Call agent
    const response = await callAgent(context);
    context.push({ role: 'assistant', content: response.content });

    // Send initial response to user
    socket.emit('message', response.content);

    // Run supervisor loop for task completion
    while (!taskQueue.isEmpty()) {
      const result = await supervisor.runLoop(context, callAgent);
      context = result.context;

      // Stream updates to user
      if (result.status === 'in_progress') {
        socket.emit('task_update', {
          task: result.currentTask,
          message: context[context.length - 1].content
        });
      }

      if (result.status === 'idle') {
        socket.emit('tasks_complete');
        break;
      }
    }
  });
});
```

### Option 2: HTTP API Handler

```javascript
// In src/routes/api.js

const supervisor = require('../lib/supervisor');
const taskQueue = require('../lib/taskQueue');

global.taskQueue = taskQueue;

router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  const context = await getContext(sessionId);

  // Add user message
  context.push({ role: 'user', content: message });

  // Call agent
  const response = await callAgent(context);
  context.push({ role: 'assistant', content: response.content });

  // Run supervisor loop
  while (!taskQueue.isEmpty()) {
    const result = await supervisor.runLoop(context, callAgent);
    context = result.context;

    if (result.status === 'idle') break;
  }

  // Save context
  await saveContext(sessionId, context);

  // Return final response
  res.json({
    message: response.content,
    tasks: taskQueue.getStatus()
  });
});
```

## Agent Prompt Updates

Add this to the agent's system prompt (in CLAUDE.md or similar):

```markdown
## Task Queue System

You have access to a task queue that keeps you running until all work is complete.

**How to use:**

1. When starting work, declare the task:
   ```javascript
   taskQueue.addTask({
     id: 'unique-id',
     description: 'What you are doing',
     type: 'pr|issue|commit',
     context: { /* relevant data */ }
   });
   ```

2. Work on the task normally

3. If you need follow-up work, declare it BEFORE completing:
   ```javascript
   taskQueue.addTask({
     id: 'followup-id',
     description: 'Follow-up work',
     ...
   });
   ```

4. When the supervisor asks "Is task X complete?", respond:
   - If complete: Include `TASK_COMPLETE: <task-id>` in your response
   - If not complete: Continue working, explain what's left

**The supervisor will:**
- Keep you running until the queue is empty
- Prompt you to verify task completion
- Start the next task automatically
- Prevent you from going idle mid-task

**Example:**

User: "Create a PR for issue #10"

You:
```javascript
taskQueue.addTask({
  id: 'pr-10',
  description: 'Create PR for issue #10',
  type: 'pr',
  context: { issue: 10 }
});
```

*... work on PR ...*

Supervisor: "Is task 'Create PR for issue #10' (ID: pr-10) complete?"

You: "Not yet, I need to update the README first."
```javascript
taskQueue.addTask({
  id: 'readme-update',
  description: 'Update README with new instructions',
  type: 'commit'
});
```

*... after updating README ...*

You: "TASK_COMPLETE: readme-update"

*... supervisor starts next task or goes idle if queue is empty ...*
```

## Testing

Run the tests to verify the integration:

```bash
npm test
```

## Monitoring

You can monitor the task queue in real-time:

```javascript
taskQueue.on('task_added', (task) => {
  console.log(`[Queue] Added: ${task.description}`);
});

taskQueue.on('task_started', (task) => {
  console.log(`[Queue] Started: ${task.description}`);
});

taskQueue.on('task_completed', (task) => {
  console.log(`[Queue] Completed: ${task.description}`);
});

taskQueue.on('queue_empty', () => {
  console.log('[Queue] All tasks complete!');
});
```

## Debugging

If the supervisor loop seems stuck:

1. Check current task:
   ```javascript
   console.log(taskQueue.getCurrentTask());
   ```

2. Check queue status:
   ```javascript
   console.log(taskQueue.getStatus());
   ```

3. Check supervisor status:
   ```javascript
   console.log(supervisor.getStatus());
   ```

4. Ensure agent is responding with `TASK_COMPLETE: <id>` when done

## Next Steps

After integration:
- Monitor task completion patterns
- Adjust supervisor prompts if needed
- Add task queue UI visualization
- Implement task persistence (DB storage)
