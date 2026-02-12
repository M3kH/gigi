const taskQueue = require('../src/lib/taskQueue');
const supervisor = require('../src/lib/supervisor');

describe('TaskQueue', () => {
  beforeEach(() => {
    // Reset queue
    taskQueue.tasks = [];
    taskQueue.currentTaskId = null;
    taskQueue.listeners = {};
  });

  test('should add task to queue', () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    const status = taskQueue.getStatus();
    expect(status.totalTasks).toBe(1);
    expect(status.pendingTasks).toBe(0); // First task auto-starts
    expect(status.inProgressTasks).toBe(1);
  });

  test('should get current task', () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    const currentTask = taskQueue.getCurrentTask();
    expect(currentTask).toBeDefined();
    expect(currentTask.id).toBe('test-1');
    expect(currentTask.status).toBe('in_progress');
  });

  test('should get next pending task', () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'First task',
      type: 'test'
    });
    taskQueue.addTask({
      id: 'test-2',
      description: 'Second task',
      type: 'test'
    });

    const nextTask = taskQueue.getNextTask();
    expect(nextTask).toBeDefined();
    expect(nextTask.id).toBe('test-2');
    expect(nextTask.status).toBe('pending');
  });

  test('supervisor should complete task and start next', () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'First task',
      type: 'test'
    });
    taskQueue.addTask({
      id: 'test-2',
      description: 'Second task',
      type: 'test'
    });

    // Supervisor completes first task
    taskQueue.completeTask('test-1');

    const status = taskQueue.getStatus();
    expect(status.totalTasks).toBe(1);
    expect(taskQueue.getCurrentTask()).toBeUndefined(); // No current task until supervisor starts next

    // Supervisor starts next task
    const nextTask = taskQueue.getNextTask();
    taskQueue.startTask(nextTask.id);

    expect(taskQueue.getCurrentTask().id).toBe('test-2');
  });

  test('should check if queue is empty', () => {
    expect(taskQueue.isEmpty()).toBe(true);

    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    expect(taskQueue.isEmpty()).toBe(false);

    taskQueue.completeTask('test-1');

    expect(taskQueue.isEmpty()).toBe(true);
  });

  test('should emit events', (done) => {
    let eventsFired = [];

    taskQueue.on('task_added', (task) => {
      eventsFired.push('added');
    });

    taskQueue.on('task_started', (task) => {
      eventsFired.push('started');
    });

    taskQueue.on('task_completed', (task) => {
      eventsFired.push('completed');
    });

    taskQueue.on('queue_empty', () => {
      eventsFired.push('empty');
      expect(eventsFired).toEqual(['added', 'started', 'completed', 'empty']);
      done();
    });

    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    taskQueue.completeTask('test-1');
  });
});

describe('Supervisor', () => {
  beforeEach(() => {
    // Reset queue and supervisor
    taskQueue.tasks = [];
    taskQueue.currentTaskId = null;
    taskQueue.listeners = {};
    supervisor.context = [];
  });

  test('should return idle when queue is empty', async () => {
    const mockCallAgent = jest.fn();
    const result = await supervisor.runLoop([], mockCallAgent);

    expect(result.status).toBe('idle');
    expect(mockCallAgent).not.toHaveBeenCalled();
  });

  test('should prompt agent to verify task completion', async () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    const mockCallAgent = jest.fn().mockResolvedValue({
      content: 'TASK_COMPLETE: test-1'
    });

    const result = await supervisor.runLoop([], mockCallAgent);

    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Is task "Test task"')
        })
      ])
    );

    expect(result.status).toBe('idle'); // Queue should be empty after completion
    expect(taskQueue.isEmpty()).toBe(true);
  });

  test('should continue loop if agent has not completed task', async () => {
    taskQueue.addTask({
      id: 'test-1',
      description: 'Test task',
      type: 'test'
    });

    const mockCallAgent = jest.fn().mockResolvedValue({
      content: 'Still working on it...'
    });

    const result = await supervisor.runLoop([], mockCallAgent);

    expect(result.status).toBe('in_progress');
    expect(result.currentTask.id).toBe('test-1');
    expect(taskQueue.isEmpty()).toBe(false);
  });
});
