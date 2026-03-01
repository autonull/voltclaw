import { EventEmitter } from 'events';
import { VoltClawAgent } from './agent.js';
import type { Tool, ToolCallResult } from '../tools/types.js';

export interface SpawnedTask {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startTime: number;
}

export class SpawnManager extends EventEmitter {
  private tasks: Map<string, SpawnedTask> = new Map();
  private agent: VoltClawAgent | null = null;

  constructor(agent?: VoltClawAgent) {
    super();
    if (agent) this.agent = agent;
  }

  setAgent(agent: VoltClawAgent): void {
    this.agent = agent;
  }

  private activePromises: Map<string, Promise<void>> = new Map();

  async spawnTask(task: string, context?: Record<string, unknown>): Promise<string> {
    if (!this.agent) throw new Error('SpawnManager not initialized with agent');

    const id = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const taskInfo: SpawnedTask = {
      id,
      task,
      status: 'running',
      startTime: Date.now()
    };
    this.tasks.set(id, taskInfo);

    const promise = this.runTask(id, task, context).catch(err => {
      console.error(`Spawned task ${id} failed unhandled:`, err);
    }).finally(() => {
      this.activePromises.delete(id);
    });

    this.activePromises.set(id, promise);

    return id;
  }

  private async runTask(id: string, task: string, context?: Record<string, unknown>): Promise<void> {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const taskInfo = this.tasks.get(id)!;

    try {
      if (!this.agent) return;

      // Use a new session or distinct context
      const result = await this.agent.query(`[BACKGROUND TASK ${id}] ${task}\nContext: ${JSON.stringify(context || {})}`);

      taskInfo.status = 'completed';
      taskInfo.result = result;
      this.emit('taskCompleted', taskInfo);
    } catch (error) {
      taskInfo.status = 'failed';
      taskInfo.error = error instanceof Error ? error.message : String(error);
      this.emit('taskFailed', taskInfo);
    }
  }

  async waitForAll(): Promise<void> {
    await Promise.allSettled(this.activePromises.values());
  }

  getTasks(): SpawnedTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): SpawnedTask | undefined {
    return this.tasks.get(id);
  }
}

export const createSpawnTool = (manager: SpawnManager): Tool => ({
  name: 'spawn',
  description: 'Spawn a background task that runs independently. Useful for long-running operations like monitoring or scraping.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task description' },
      context: { type: 'object', description: 'Optional context data' }
    },
    required: ['task']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const { task, context } = args;
    if (typeof task !== 'string') return { error: 'Task must be a string' };

    const id = await manager.spawnTask(task, context as Record<string, unknown>);
    return { status: 'spawned', taskId: id, message: 'Task started in background' };
  }
});
