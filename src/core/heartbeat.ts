import { readFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { VoltClawAgent } from './agent.js';
import { WORKSPACE_DIR } from './workspace.js';

export class HeartbeatManager {
  private agent: VoltClawAgent;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private consecutiveFailures: number = 0;

  constructor(agent: VoltClawAgent, intervalMs: number = 30 * 60 * 1000) { // Default 30 minutes
    this.agent = agent;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.executeHeartbeat(), this.intervalMs);
    // console.debug(`Heartbeat started with interval ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      // console.debug('Heartbeat stopped');
    }
  }

  private async logError(error: unknown): Promise<void> {
    const logsDir = join(WORKSPACE_DIR, 'logs');
    const logFile = join(logsDir, 'heartbeat_errors.log');

    try {
      await mkdir(logsDir, { recursive: true });
      const message = `[${new Date().toISOString()}] Heartbeat Error: ${error instanceof Error ? error.message : String(error)}\n`;
      await appendFile(logFile, message);
    } catch (e) {
      console.error('Failed to write to heartbeat log:', e);
    }
  }

  private async executeHeartbeat(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const heartbeatFile = join(WORKSPACE_DIR, 'HEARTBEAT.md');
      let content = '';
      try {
        content = await readFile(heartbeatFile, 'utf-8');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return;
      }

      if (!content.trim()) return;

      const tasks = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- [ ]') || line.startsWith('- '))
        .map(line => line.replace(/^- \[[ x]\] /, '').replace(/^- /, ''));

      if (tasks.length === 0) return;

      // console.debug(`Running heartbeat tasks: ${tasks.join(', ')}`);

      const prompt = `System Heartbeat Triggered.
The following periodic tasks are defined in HEARTBEAT.md:
${tasks.map(t => `- ${t}`).join('\n')}

Please review these tasks and execute any that are relevant or due.
If a task requires long-running work, use the 'spawn' tool.
Report the status of each task briefly.`;

      await this.agent.query(prompt, { metadata: { source: 'heartbeat' } });
      this.consecutiveFailures = 0;

    } catch (error) {
      this.consecutiveFailures++;
      console.error(`Heartbeat execution failed (attempt ${this.consecutiveFailures}):`, error);
      await this.logError(error);

      // Retry logic for first few failures with backoff if we were using a more complex scheduler
      // Here we just log and wait for next interval
    } finally {
      this.isRunning = false;
    }
  }
}
