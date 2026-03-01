import { Channel, MessageHandler, EventHandler, Unsubscribe } from '../core/types.js';
import * as readline from 'readline';

export class StdioChannel implements Channel {
  readonly type = 'stdio';
  readonly identity = { publicKey: 'self' };

  private rl?: readline.Interface;
  private handlers: Set<MessageHandler> = new Set();
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    this.rl.on('line', (line) => {
      this.handleInput(line);
    });

    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = undefined;
    this.emit('disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    // In stdio, we just print to stdout
    // Maybe format it?
    if (to !== 'self') {
      console.log(`[${to}] ${content}`);
    } else {
      console.log(content);
    }
  }

  subscribe(handler: MessageHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    } else {
      this.eventHandlers.set(event, new Set([handler]));
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(h => h(...args));
    }
  }

  private async handleInput(line: string): Promise<void> {
    if (line.trim() === '') return;

    // Treat stdin as a message from 'user'
    for (const handler of this.handlers) {
      await handler('user', line, { timestamp: Date.now() });
    }
  }
}
