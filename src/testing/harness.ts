





// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { VoltClawAgent, type VoltClawAgentOptions, type LLMProvider, type Channel, type Store, type Session, type Tool, type ChatMessage, type ChatResponse, type ChatOptions, type Unsubscribe, type MessageMeta } from '../core/index.js';
import { MockRelay, MockClient } from './mock-relay.js';
import { MockLLM, createMockLLM, type MockLLMConfig } from './mock-llm.js';
import { getPublicKey, finalizeEvent, nip04 } from 'nostr-tools';
import { RelayPool } from 'nostr-relaypool';

export interface TestHarnessConfig {
  llm?: MockLLMConfig | MockLLM;
  relayPort?: number;
  call?: VoltClawAgentOptions['call'];
  rlm?: VoltClawAgentOptions['rlm'];
}

export class TestHarness {
  public agent: VoltClawAgent;
  public llm: MockLLM;
  public relay: MockRelay;
  public client: MockClient;
  
  private isRunning = false;
  private agentPubkey: string = '';

  constructor(config: TestHarnessConfig = {}) {
    this.relay = new MockRelay(config.relayPort ?? 40404);
    this.llm = config.llm instanceof MockLLM
      ? config.llm
      : createMockLLM(config.llm ?? {});
    this.client = new MockClient();

    const testKey = generateTestKey();
    this.agentPubkey = getPublicKey(testKey);

    const channel = createNostrChannel(this.relay.url, testKey);
    const store = createMemoryStore();

    this.agent = new VoltClawAgent({
      llm: this.llm,
      channel,
      persistence: store,
      call: config.call ?? {
        maxDepth: 2,
        maxCalls: 5,
        budgetUSD: 0.50
      },
      rlm: config.rlm,
      tools: [
        {
          name: 'get_time',
          description: 'Get current time',
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          execute: async () => ({ time: new Date().toISOString() })
        }
      ]
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    await this.relay.start();
    await this.agent.start();
    await this.client.connect(this.relay.url);
    await this.client.subscribe();
    
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    await this.agent.stop();
    await this.client.disconnect();
    await this.relay.stop();
    
    this.isRunning = false;
  }

  async query(message: string): Promise<string> {
      return this.agent.query(message);
  }

  async send(message: string): Promise<string> {
    await this.client.sendDM(this.agentPubkey, message);
    const reply = await this.client.waitForDM(60000);
    return reply.content;
  }

  get callCount(): number {
    return this.llm.getCallCount();
  }

  get delegationCount(): number {
      // Compatibility alias if tests check this
      const session = this.agent['store'].get('self', true);
      return session.callCount;
  }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  get events() {
    return this.relay.getEvents();
  }
}

function generateTestKey(): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = Math.floor(Math.random() * 256);
  }
  return key;
}

function createNostrChannel(relayUrl: string, secretKey: Uint8Array): Channel {
  const publicKey = getPublicKey(secretKey);
  const pool = new RelayPool();
  pool.addOrGetRelay(relayUrl);
  
  const eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  
  return {
    type: 'nostr',
    identity: { publicKey },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async start() {
      eventHandlers.get('connected')?.forEach(h => h());
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async stop() {
      // Simple stop mock
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async send(to: string, content: string) {
      const encrypted = await nip04.encrypt(secretKey, to, content);
      const ev = finalizeEvent({
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', to]],
        content: encrypted
      }, secretKey);
      pool.publish(ev, [relayUrl]);
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    subscribe(handler) {
      const unsub = pool.subscribe(
        [{ kinds: [4], '#p': [publicKey] }],
        [relayUrl],
        async (event: unknown) => {
          const ev = event as { id: string; pubkey: string; content: string; created_at: number; kind: number; tags: string[][] };
          try {
            const decrypted = await nip04.decrypt(secretKey, ev.pubkey, ev.content);
            await handler(ev.pubkey, decrypted, { eventId: ev.id, timestamp: ev.created_at, kind: ev.kind, tags: ev.tags });
          } catch {
            // Ignore
          }
        }
      );
      return unsub;
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    on(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      eventHandlers.get(event)!.add(handler);
    }
  };
}

function createMemoryStore(): Store {
  const data: Record<string, Session> = {};
  return {
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    get(key: string) {
      if (!data[key]) {
        data[key] = {
          history: [],
          callCount: 0,
          estCostUSD: 0,
          actualTokensUsed: 0,
          subTasks: {},
          depth: 0,
          topLevelStartedAt: 0
        };
      }
      return data[key];
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    getAll() {
      return { ...data };
    },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async load() {},
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async save() {},
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    clear() {
// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      Object.keys(data).forEach(k => delete data[k]);
    }
  };
}

export async function createTestHarness(config: TestHarnessConfig = {}): Promise<TestHarness> {
  const harness = new TestHarness(config);
  await harness.start();
  return harness;
}
