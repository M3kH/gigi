/**
 * Supervisor Loop
 *
 * Monitors the task queue and prompts the agent to verify task completion.
 * This prevents incomplete outputs from stalling the queue.
 *
 * Design:
 * 1. Agent declares tasks via addTask(...)
 * 2. Supervisor monitors queue after each agent response
 * 3. When agent stops generating, supervisor checks if current task is complete
 * 4. Supervisor prompts agent: "Is task X complete? Verify and continue."
 * 5. Agent responds with confirmation or continues work
 * 6. Supervisor removes completed tasks and starts next
 */

const taskQueue = require('./taskQueue');

class Supervisor {
  constructor() {
    this.context = []; // Conversation history
    this.isRunning = false;
  }

  /**
   * Main supervisor loop
   * Called after each agent response
   *
   * @param {Array} conversationContext - Current conversation history
   * @param {Function} callAgent - Function to call the agent (LLM)
   */
  async runLoop(conversationContext, callAgent) {
    this.context = conversationContext;

    // Check if there's work to do
    if (taskQueue.isEmpty()) {
      console.log('[Supervisor] No tasks in queue, agent idle');
      return { status: 'idle', context: this.context };
    }

    // Get current task
    let currentTask = taskQueue.getCurrentTask();

    // If no task is in progress, start the next one
    if (!currentTask) {
      const nextTask = taskQueue.getNextTask();
      if (nextTask) {
        console.log(`[Supervisor] Starting next task: ${nextTask.id}`);
        taskQueue.startTask(nextTask.id);
        currentTask = nextTask;
      }
    }

    if (!currentTask) {
      console.log('[Supervisor] No current task, going idle');
      return { status: 'idle', context: this.context };
    }

    // Prompt agent to verify task completion
    console.log(`[Supervisor] Checking completion of task: ${currentTask.id} - ${currentTask.description}`);

    this.context.push({
      role: 'user',
      content: `Is task "${currentTask.description}" (ID: ${currentTask.id}) complete? Verify and continue if needed. If complete, explicitly state "TASK_COMPLETE: ${currentTask.id}". If not complete or you need to do follow-up work, continue with the task.`
    });

    // Call agent to verify
    const response = await callAgent(this.context);
    this.context.push({
      role: 'assistant',
      content: response.content
    });

    // Check if agent confirmed completion
    if (response.content.includes(`TASK_COMPLETE: ${currentTask.id}`)) {
      console.log(`[Supervisor] Task ${currentTask.id} confirmed complete by agent`);
      taskQueue.completeTask(currentTask.id);

      // Continue loop if there are more tasks
      if (!taskQueue.isEmpty()) {
        console.log('[Supervisor] More tasks in queue, continuing...');
        return this.runLoop(this.context, callAgent);
      } else {
        console.log('[Supervisor] All tasks complete, agent idle');
        return { status: 'idle', context: this.context };
      }
    }

    // Agent is still working on the task
    console.log(`[Supervisor] Task ${currentTask.id} still in progress`);
    return { status: 'in_progress', context: this.context, currentTask };
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      queueStatus: taskQueue.getStatus(),
      contextLength: this.context.length
    };
  }
}

// Singleton instance
const supervisor = new Supervisor();

module.exports = supervisor;
