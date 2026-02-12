/**
 * Self-perpetuating task queue with progress reporting
 * Ensures Gigi completes all work before going idle
 */

class TaskQueue {
  constructor() {
    this.tasks = [];
    this.isRunning = false;
    this.currentTaskId = null;
  }

  /**
   * Add a new task to the queue
   * @param {Object} task - Task object
   * @param {string} task.id - Unique task identifier
   * @param {string} task.description - Human-readable task description
   * @param {string} task.type - Task type (e.g., 'pr', 'issue', 'commit')
   * @param {Object} task.context - Additional context for the task
   */
  addTask(task) {
    if (!task.id || !task.description) {
      throw new Error('Task must have id and description');
    }

    this.tasks.push({
      ...task,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    console.log(`[TaskQueue] Added task ${task.id}: ${task.description}`);
    this.emit('task_added', task);

    // Start processing if idle
    if (!this.isRunning) {
      this.processNext();
    }
  }

  /**
   * Mark current task as complete and process next
   * @param {string} taskId - Task ID to complete
   */
  completeTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) {
      console.warn(`[TaskQueue] Task ${taskId} not found`);
      return;
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();

    console.log(`[TaskQueue] Completed task ${taskId}: ${task.description}`);
    this.emit('task_completed', task);

    // Remove completed task from queue
    this.tasks = this.tasks.filter(t => t.id !== taskId);

    // Continue with next task
    this.isRunning = false;
    this.currentTaskId = null;
    this.processNext();
  }

  /**
   * Process the next pending task
   */
  async processNext() {
    if (this.isRunning || this.tasks.length === 0) {
      if (this.tasks.length === 0) {
        console.log('[TaskQueue] Queue empty, going idle');
        this.emit('queue_empty');
      }
      return;
    }

    const task = this.tasks[0];
    this.isRunning = true;
    this.currentTaskId = task.id;
    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();

    console.log(`[TaskQueue] Starting task ${task.id}: ${task.description}`);
    this.emit('task_started', task);

    // The agent runtime will handle actual execution
    // This just manages the queue state
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentTaskId: this.currentTaskId,
      pendingTasks: this.tasks.filter(t => t.status === 'pending').length,
      totalTasks: this.tasks.length,
      tasks: this.tasks
    };
  }

  /**
   * Simple event emitter for task queue events
   */
  emit(event, data) {
    if (this.listeners && this.listeners[event]) {
      this.listeners[event].forEach(listener => listener(data));
    }
  }

  on(event, listener) {
    if (!this.listeners) this.listeners = {};
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }
}

// Singleton instance
const taskQueue = new TaskQueue();

module.exports = taskQueue;
