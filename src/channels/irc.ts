import { Client } from 'irc-framework';
import type { Channel, MessageHandler, Unsubscribe, EventHandler } from '../core/types.js';

export interface IrcChannelConfig {
  server: string;
  port?: number;
  nick: string;
  channels?: string[];
  password?: string;
}

export class IrcChannel implements Channel {
  public readonly type = 'irc';
  public readonly identity: { publicKey: string };

  private client: Client;
  private config: IrcChannelConfig;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnected = false;

  constructor(config: IrcChannelConfig) {
    this.config = config;
    this.identity = { publicKey: config.nick };
    this.client = new Client();

    this.client.on('message', (event: any) => {
      // Ignore our own messages
      if (event.nick === this.config.nick) {
        return;
      }

      const target = event.target === this.config.nick ? event.nick : event.target; // DM vs Channel
      const content = event.message;

      // Create a meta object for the IRC message
      const meta = {
        timestamp: Date.now(),
        kind: 1, // Regular message
        tags: [['channel', event.target]]
      };

      for (const handler of this.messageHandlers) {
        handler(target, content, meta).catch((e: Error) => console.error('Error in IRC message handler:', e));
      }
    });

    this.client.on('error', (err: any) => {
      console.error('IRC Client Error:', err);
    });
  }

  async start(): Promise<void> {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      this.client.on('registered', () => {
        this.isConnected = true;
        if (this.config.channels) {
          for (const channel of this.config.channels) {
            this.client.join(channel);
          }
        }
        resolve();
      });

      this.client.on('error', (err: any) => {
        if (!this.isConnected) {
            reject(err);
        }
      });

      this.client.connect({
        host: this.config.server,
        port: this.config.port ?? 6667,
        nick: this.config.nick,
        password: this.config.password
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.isConnected) return;
    this.client.quit();
    this.isConnected = false;
  }

  async send(to: string, content: string): Promise<void> {
    if (!this.isConnected) throw new Error('IRC channel not connected');
    this.client.say(to, content);
  }

  subscribe(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
    if (event === 'connected') {
      this.client.on('registered', handler);
    } else if (event === 'disconnected') {
      this.client.on('close', handler);
    } else if (event === 'error') {
      this.client.on('error', handler);
    }
  }
}
