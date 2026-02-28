import { Client, GatewayIntentBits, type Message } from 'discord.js';
import type { Channel, MessageHandler, EventHandler, MessageMeta } from '../core/types.js';

export interface DiscordConfig {
  token: string;
}

export class DiscordChannel implements Channel {
  public readonly type = 'discord';
  public readonly identity: { publicKey: string };
  private client: Client;
  private messageHandler?: MessageHandler;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private token: string;

  constructor(config: DiscordConfig) {
    this.token = config.token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });
    this.identity = { publicKey: 'discord-bot' };
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once('ready', (c) => {
        this.identity.publicKey = c.user.tag;
        this.emit('connected');
        resolve();
      });

      this.client.on('messageCreate', async (message: Message) => {
        if (message.author.bot) return;
        if (!this.messageHandler) return;

        const from = message.channelId;
        const content = message.content;

        const meta: MessageMeta = {
          timestamp: message.createdTimestamp,
          kind: 1,
          tags: [
            ['platform', 'discord'],
            ['author_id', message.author.id],
            ['author_tag', message.author.tag]
          ]
        };

        await this.messageHandler(from, content, meta);
      });

      this.client.login(this.token).catch(reject);
    });
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    this.emit('disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(to);
      if (channel && 'send' in channel && typeof channel.send === 'function') {
        await channel.send(content);
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
     if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.push(handler);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(h => h(...args));
    }
  }
}