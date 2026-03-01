import cron from 'node-cron';
import type { VoltClawAgent } from './agent.js';
import type { ScheduledTask } from './types.js';

export class Scheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  constructor(private agent: VoltClawAgent) {}

  async start(): Promise<void> {
    if (!this.agent.getStore().getScheduledTasks) {
      // Store does not support scheduling
      return;
    }

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tasks = await this.agent.getStore().getScheduledTasks!();
    for (const task of tasks) {
      this.scheduleJob(task);
    }
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  async schedule(cronExpression: string, taskDescription: string, target?: string): Promise<string> {
    if (!this.agent.getStore().scheduleTask) {
      throw new Error('Persistence store does not support scheduling');
    }

    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const task: ScheduledTask = {
      id,
      cron: cronExpression,
      task: taskDescription,
      createdAt: Date.now(),
      target
    };

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.agent.getStore().scheduleTask!(task);
    this.scheduleJob(task);

    return id;
  }

  async list(): Promise<ScheduledTask[]> {
    if (!this.agent.getStore().getScheduledTasks) {
      return [];
    }
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.agent.getStore().getScheduledTasks!();
  }

  async cancel(id: string): Promise<void> {
    if (!this.agent.getStore().deleteScheduledTask) {
      throw new Error('Persistence store does not support scheduling');
    }

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.agent.getStore().deleteScheduledTask!(id);
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private scheduleJob(task: ScheduledTask): void {
    if (this.jobs.has(task.id)) {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.jobs.get(task.id)!.stop();
    }

    const job = cron.schedule(task.cron, async () => {
      try {
        // Update last run time
        const updatedTask = { ...task, lastRun: Date.now() };
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.agent.getStore().scheduleTask!(updatedTask);

        // Execute task
        // We run it as a new "user" interaction from the scheduler system
        // Or we can spawn a sub-agent.
        // Let's use `agent.query` but we need to be careful about where the reply goes.
        // It goes to the configured channel.
        // We should probably log it or send it to self.

        // For now, we execute it and log the result.
        // Ideally, we send a message to the "owner" (admin) via the channel.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
        const notification = `[Scheduler] Executing task: ${task.task}`;
        // We can't easily "push" to the admin unless we know who they are.
        // But `agent.query` assumes a reply to the caller.
        // If we call it programmatically, we get the result.

        // Let's just run it and log it for now.
        // Or send it to the channel if it supports broadcasting (Nostr does).
        // But we don't want to spam public.

        // Best approach: Just run it. The task itself might involve sending messages.
        // e.g. "Check weather and DM me".

        const result = await this.agent.query(`[Scheduled Task] ${task.task}`);
        console.log(`[Scheduler] Task ${task.id} completed:`, result);

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (task.target) {
            await this.agent.send(task.target, result);
        }

      } catch (error) {
        console.error(`[Scheduler] Task ${task.id} failed:`, error);
      }
    });

    this.jobs.set(task.id, job);
  }
}
