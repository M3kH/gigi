# Task Queue System

## Overview

The task queue ensures Gigi completes all work autonomously without getting stuck mid-task.

## How It Works

```javascript
const taskQueue = require('./lib/taskQueue');

// Add a task
taskQueue.addTask({
  id: 'create-pr-1',
  description: 'Create PR for issue #10',
  type: 'pr',
  context: { issue: 10, branch: 'feat/task-queue' }
});

// Complete when done
taskQueue.completeTask('create-pr-1');
```

## Rules

1. **Always `addTask` before starting work**
2. **Add follow-up tasks BEFORE completing current task**
3. **Call `completeTask` only when truly done**
4. **The queue keeps you running until empty**

## Example Flow

```javascript
// User: "Create a PR for gigi#10"
taskQueue.addTask({ id: 1, description: "Create PR for gigi#10" });
// → Queue starts processing

// During execution, realize README needs update
taskQueue.addTask({ id: 2, description: "Update README" });
taskQueue.completeTask(1); // PR task done

// Queue automatically starts task 2
// ... update README ...
taskQueue.addTask({ id: 3, description: "Commit and push changes" });
taskQueue.completeTask(2);

// Queue starts task 3
// ... push complete ...
taskQueue.completeTask(3);

// Queue is empty → goes idle
```

## Events

```javascript
taskQueue.on('task_added', (task) => { /* ... */ });
taskQueue.on('task_started', (task) => { /* ... */ });
taskQueue.on('task_completed', (task) => { /* ... */ });
taskQueue.on('queue_empty', () => { /* All work done! */ });
```

## Status

```javascript
const status = taskQueue.getStatus();
// {
//   isRunning: true,
//   currentTaskId: 'create-pr-1',
//   pendingTasks: 2,
//   totalTasks: 3,
//   tasks: [...]
// }
```

## Integration

The task queue is integrated with the agent runtime to:
1. Report progress between stages
2. Log command output
3. Keep agent alive until queue empties
4. Prevent premature idle states
