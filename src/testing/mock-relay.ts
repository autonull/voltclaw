import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip04
} from 'nostr-tools';

export interface TestEvent {
  id?: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export class MockRelay {
  private server: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private clients: Set<WebSocket> = new Set();
  private events: TestEvent[] = [];
  private subscriptions: Map<WebSocket, Array<{ subId: string; filters: Record<string, unknown>[] }>> = new Map();
  private port: number;

  constructor(port = 40404) {
    this.port = port;
    this.httpServer = createServer();
    this.server = new WebSocketServer({ server: this.httpServer });
    
    this.server.on('connection', (ws) => {
      this.clients.add(ws);
      
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as unknown[];
          this.handleMessage(ws, msg);
        } catch {
          // Ignore parse errors
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });
    });
  }

  private handleMessage(ws: WebSocket, msg: unknown[]): void {
    const [type, ...args] = msg;
    
    switch (type) {
      case 'EVENT':
        this.handleEvent(ws, args[0] as TestEvent);
        break;
      case 'REQ':
        this.handleSubscribe(ws, args[0] as string, args.slice(1) as Record<string, unknown>[]);
        break;
      case 'CLOSE':
        this.subscriptions.delete(ws);
        break;
    }
  }

  private handleEvent(ws: WebSocket, event: TestEvent): void {
    this.events.push(event);
    const eventId = event.id ?? 'unknown';
    ws.send(JSON.stringify(['OK', eventId, true, '']));
    this.broadcastEvent(event);
  }

  private handleSubscribe(ws: WebSocket, subId: string, filters: Record<string, unknown>[]): void {
    if (!this.subscriptions.has(ws)) {
      this.subscriptions.set(ws, []);
    }
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.subscriptions.get(ws)!.push({ subId, filters });
    
    for (const filter of filters) {
      const matching = this.events.filter(e => this.matchesFilter(e, filter));
      for (const event of matching) {
        ws.send(JSON.stringify(['EVENT', subId, event]));
      }
    }
    ws.send(JSON.stringify(['EOSE', subId]));
  }

  private matchesFilter(event: TestEvent, filter: Record<string, unknown>): boolean {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (filter['kinds'] && !((filter['kinds'] as number[]).includes(event.kind))) return false;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (filter['authors'] && !((filter['authors'] as string[]).includes(event.pubkey))) return false;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (filter['#p'] && !event.tags.some(t => t[0] === 'p' && (filter['#p'] as string[]).includes(t[1] ?? ''))) return false;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (filter['since'] && event.created_at < (filter['since'] as number)) return false;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (filter['until'] && event.created_at > (filter['until'] as number)) return false;
    return true;
  }

  private broadcastEvent(event: TestEvent): void {
    for (const [ws, subs] of this.subscriptions) {
      for (const sub of subs) {
        for (const filter of sub.filters) {
          if (this.matchesFilter(event, filter)) {
            ws.send(JSON.stringify(['EVENT', sub.subId, event]));
          }
        }
      }
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const ws of this.clients) {
        ws.close();
      }
      this.events = [];
      this.subscriptions.clear();
      this.server.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }

  clear(): void {
    this.events = [];
    this.subscriptions.clear();
  }

  getEvents(): TestEvent[] {
    return [...this.events];
  }

  get url(): string {
    return `ws://localhost:${this.port}`;
  }
}

export class MockClient {
  private ws: WebSocket | null = null;
  private secretKey: Uint8Array;
  public publicKey: string;
  private messageQueue: unknown[] = [];

  constructor() {
    this.secretKey = generateSecretKey();
    this.publicKey = getPublicKey(this.secretKey);
  }

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => resolve());
      this.ws.on('message', (data) => {
        this.messageQueue.push(JSON.parse(data.toString()));
      });
      this.ws.on('error', reject);
    });
  }

  async sendDM(to: string, content: string): Promise<void> {
    const encrypted = await nip04.encrypt(this.secretKey, to, content);
    const event = finalizeEvent({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', to]],
      content: encrypted
    }, this.secretKey);
    
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.ws!.send(JSON.stringify(['EVENT', event]));
  }

  subscribe(): void {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.ws!.send(JSON.stringify(['REQ', 'sub', {
      kinds: [4],
      '#p': [this.publicKey]
    }]));
  }

  async waitForDM(timeout = 30000): Promise<{ from: string; content: string }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      for (let i = 0; i < this.messageQueue.length; i++) {
        const msg = this.messageQueue[i] as unknown[];
        if (msg[0] === 'EVENT' && (msg[2] as TestEvent)?.kind === 4) {
          this.messageQueue.splice(i, 1);
          const event = msg[2] as TestEvent;
          try {
            const content = await nip04.decrypt(this.secretKey, event.pubkey, event.content);
            return { from: event.pubkey, content };
          } catch {
            continue;
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Timeout waiting for DM');
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws) {
        this.ws.close();
        this.ws.on('close', resolve);
      } else {
        resolve();
      }
    });
  }
}
