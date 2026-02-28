import { Telegraf, type Context } from 'telegraf';
import type { Channel, MessageHandler, EventHandler, MessageMeta } from '../core/types.js';

export interface TelegramConfig {
  token: string;
}

export class TelegramChannel implements Channel {
  public readonly type = 'telegram';
  public readonly identity: { publicKey: string };
  private bot: Telegraf;
  private messageHandler?: MessageHandler;
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.token);
    this.identity = { publicKey: 'telegram-bot' };
  }

  async start(): Promise<void> {
    try {
      const me = await this.bot.telegram.getMe();
      this.identity.publicKey = me.username ?? 'telegram-bot';

      this.bot.on('text', async (ctx: Context) => {
        if (this.messageHandler === undefined) return;
        if (ctx.message === undefined || !('text' in ctx.message)) return;

        const from = String(ctx.chat?.id ?? 'unknown');
        const content = ctx.message.text ?? '';

        const meta: MessageMeta = {
          timestamp: ctx.message.date * 1000,
          kind: 1,
          tags: [
            ['platform', 'telegram'],
            ['chat_id', String(ctx.chat?.id ?? 'unknown')],
            ['user_id', String(ctx.message.from?.id ?? 'unknown')],
            ['username', ctx.message.from?.username ?? 'unknown']
          ]
        };

        await this.messageHandler(from, content, meta);
      });

      this.bot.launch(() => {
          this.emit('connected');
      }).catch((err: Error) => {
          this.emit('error', err);
      });

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.bot.stop();
    this.emit('disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    try {
        await this.bot.telegram.sendMessage(to, content);
    } catch (error) {
        console.error('Telegram send error:', error);
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.push(handler as EventHandler);
    } else {
      this.eventHandlers.set(event, [handler as EventHandler]);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(h => h(...args));
    }
  }
}