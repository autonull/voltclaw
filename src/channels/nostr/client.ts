import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip04,
  verifyEvent,
  validateEvent,
  nip19
} from 'nostr-tools';
import { RelayPool } from 'nostr-relaypool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
import type {
  Channel,
  MessageHandler,
  MessageMeta,
  QueryFilter,
  ChannelMessage,
  NostrEvent,
  Unsubscribe,
  EventHandler
} from './types.js';

useWebSocketImplementation(WebSocket);

export interface NostrClientOptions {
  relays: string[];
  privateKey?: string;
}

function decodePrivateKey(key: string): Uint8Array {
  if (key.startsWith('nsec')) {
    const decoded = nip19.decode(key);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec key');
    }
    return decoded.data;
  }
  return Uint8Array.from(Buffer.from(key, 'hex'));
}

export function resolveToHex(key: string): string {
  if (key.startsWith('npub')) {
    const decoded = nip19.decode(key);
    if (decoded.type !== 'npub') {
      throw new Error('Invalid npub key');
    }
    return decoded.data as string;
  }
  if (key.startsWith('nsec')) {
    const decoded = nip19.decode(key);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec key');
    }
    return Buffer.from(decoded.data).toString('hex');
  }
  return key;
}

export class NostrClient implements Channel {
  readonly type = 'nostr';
  readonly identity: { publicKey: string };
  
  private pool: RelayPool;
  private secretKey: Uint8Array;
  private seenEvents: Set<string> = new Set();
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private isStarted = false;

  constructor(options: NostrClientOptions) {
    if (options.privateKey != null && options.privateKey.length > 0) {
      this.secretKey = decodePrivateKey(options.privateKey);
    } else {
      this.secretKey = generateSecretKey();
    }
    
    this.identity = {
      publicKey: getPublicKey(this.secretKey)
    };
    
    this.pool = new RelayPool();
    
    for (const relay of options.relays) {
      this.pool.addOrGetRelay(relay);
    }
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;
    
    for (const relay of this.pool.relayByUrl.keys()) {
      this.pool.removeRelay(relay);
    }
    
    this.isStarted = false;
    this.emit('disconnected');
  }

  async send(to: string, content: string): Promise<void> {
    const encrypted = await nip04.encrypt(this.secretKey, to, content);
    
    const event = finalizeEvent(
      {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', to]],
        content: encrypted
      },
      this.secretKey
    );

    const relays = Array.from(this.pool.relayByUrl.keys());
    this.pool.publish(event, relays);
  }

  subscribe(handler: MessageHandler): Unsubscribe {
    const unsub = this.pool.subscribe(
      [{ kinds: [4], '#p': [this.identity.publicKey] }],
      Array.from(this.pool.relayByUrl.keys()),
      async (event: unknown) => {
        const ev = event as NostrEvent;
        if (this.seenEvents.has(ev.id)) return;
        this.seenEvents.add(ev.id);

        if (!validateEvent(ev) || !verifyEvent(ev)) {
          this.emit('error', new Error('Invalid event signature'));
          return;
        }

        try {
          const decrypted = await nip04.decrypt(
            this.secretKey,
            ev.pubkey,
            ev.content
          );
          
          const meta: MessageMeta = {
            eventId: ev.id,
            timestamp: ev.created_at,
            kind: ev.kind,
            tags: ev.tags
          };
          
          await handler(ev.pubkey, decrypted, meta);
        } catch (error) {
          this.emit('error', error);
        }
      }
    );

    return () => {
      unsub();
    };
  }

  async query(filter: QueryFilter): Promise<ChannelMessage[]> {
    return new Promise((resolve) => {
      const events: ChannelMessage[] = [];
      
      const nostrFilter: Record<string, unknown> = {
        kinds: filter.kinds ?? [4],
        '#p': [this.identity.publicKey]
      };
      
      if (filter.since !== undefined) nostrFilter['since'] = filter.since;
      if (filter.until !== undefined) nostrFilter['until'] = filter.until;
      if (filter.limit !== undefined) nostrFilter['limit'] = filter.limit;
      
      const unsub = this.pool.subscribe(
        [nostrFilter],
        Array.from(this.pool.relayByUrl.keys()),
        async (event: unknown) => {
          const ev = event as NostrEvent;
          if (!validateEvent(ev) || !verifyEvent(ev)) return;
          
          try {
            const decrypted = await nip04.decrypt(
              this.secretKey,
              ev.pubkey,
              ev.content
            );
            
            events.push({
              id: ev.id,
              from: ev.pubkey,
              to: this.identity.publicKey,
              content: decrypted,
              timestamp: ev.created_at,
              kind: ev.kind
            });
          } catch {
            // Skip events we can't decrypt
          }
        },
        undefined,
        undefined,
        { unsubscribeOnEose: true }
      );
      
      setTimeout(() => {
        unsub();
        resolve(events);
      }, 5000);
    });
  }

  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

export async function generateNewKeyPair(): Promise<{
  publicKey: string;
  secretKey: string;
  npub: string;
  nsec: string;
}> {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  
  return {
    publicKey: pk,
    secretKey: Buffer.from(sk).toString('hex'),
    npub: nip19.npubEncode(pk),
    nsec: nip19.nsecEncode(sk)
  };
}

export function getPublicKeyFromSecret(secretKey: string): string {
    const key = decodePrivateKey(secretKey);
    return getPublicKey(key);
}

export { nip19 };
