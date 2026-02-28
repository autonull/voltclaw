import type { Channel, MessageHandler, EventHandler } from '../core/types.js';

export class CompositeChannel implements Channel {
  public readonly type = 'composite';
  public readonly identity: { publicKey: string };
  private channels: Channel[];

  constructor(channels: Channel[]) {
    if (channels.length === 0 || !channels[0]) {
      throw new Error('CompositeChannel requires at least one channel');
    }
    this.channels = channels;
    this.identity = channels[0].identity;
  }

  async start(): Promise<void> {
    await Promise.all(this.channels.map(c => c.start()));
  }

  async stop(): Promise<void> {
    await Promise.all(this.channels.map(c => c.stop()));
  }

  async send(to: string, content: string): Promise<void> {
    const match = to.match(/^([^:]+):(.+)$/);

    if (match && match[1] != null && match[2] != null) {
      const type = match[1];
      const id = match[2];

      const channel = this.channels.find(c => c.type === type);

      if (channel) {
        await channel.send(id, content);
        return;
      }
    }

    if (this.channels.length > 0 && this.channels[0]) {
      await this.channels[0].send(to, content);
    }
  }

  subscribe(handler: MessageHandler): () => void {
    const unsubscribes = this.channels.map((channel, index) => {
      const isDefault = index === 0;
      return channel.subscribe(async (from, content, meta) => {
        if (isDefault) {
          await handler(from, content, meta);
        } else {
          const prefixedFrom = `${channel.type}:${from}`;
          await handler(prefixedFrom, content, meta);
        }
      });
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
    this.channels.forEach(channel => {
      channel.on(event, (...args) => {
        handler(...args);
      });
    });
  }
}