/**
 * Self-perpetuating task queue with supervisor-based completion
 *
 * Design: Agent declares tasks, but SUPERVISOR verifies completion.
 * This prevents incomplete outputs from stalling the queue.
 */

class TaskQueue {
  constructor() {
    this.tasks = [];
    this.currentTaskId = null;
    this.listeners = {};
  }

  /**
   * Agent declares a new task
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

    // Start processing if this is the first task
    if (this.tasks.length === 1 && !this.currentTaskId) {
      this.startTask(task.id);
    }
  }

  /**
   * Supervisor starts a task (called by supervisor loop)
   * @param {string} taskId - Task ID to start
   */
  startTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) {
      console.warn(`[TaskQueue] Task ${taskId} not found`);
      return;
    }

    this.currentTaskId = taskId;
    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();

    console.log(`[TaskQueue] Starting task ${taskId}: ${task.description}`);
    this.emit('task_started', task);
  }

  /**
   * Supervisor marks task as complete (NOT called by agent)
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

    // Remove completed task
    this.tasks = this.tasks.filter(t => t.id !== taskId);
    this.currentTaskId = null;

    // Supervisor will start next task
    if (this.tasks.length === 0) {
      console.log('[TaskQueue] Queue empty, going idle');
      this.emit('queue_empty');
    }
  }

  /**
   * Get current task (for supervisor to verify)
   */
  getCurrentTask() {
    return this.tasks.find(t => t.id === this.currentTaskId);
  }

  /**
   * Get next pending task (for supervisor to start)
   */
  getNextTask() {
    return this.tasks.find(t => t.status === 'pending');
  }

  /**
   * Check if queue is empty
   */
  isEmpty() {
    return this.tasks.length === 0;
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      currentTaskId: this.currentTaskId,
      pendingTasks: this.tasks.filter(t => t.status === 'pending').length,
      inProgressTasks: this.tasks.filter(t => t.status === 'in_progress').length,
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
