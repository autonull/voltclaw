import { resolveToHex, generateNewKeyPair } from '../channels/nostr/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const VOLTCLAW_DIR = path.join(os.homedir(), '.voltclaw');
export const CONFIG_FILE = path.join(VOLTCLAW_DIR, 'config.json');
export const KEYS_FILE = path.join(VOLTCLAW_DIR, 'keys.json');

export interface ChannelConfig {
  type: 'nostr' | 'telegram' | 'discord' | 'stdio' | 'irc';
  token?: string;
  relays?: string[];
  privateKey?: string;
  server?: string;
  port?: number;
  nick?: string;
  channels?: string[];
  password?: string;
}

export interface CLIConfig {
  rlm?: {
    enabled: boolean;
  };
  lcm?: {
    enabled: boolean;
    compressionLevel?: string;
  };
  profiles?: Record<string, Partial<CLIConfig>>;
  channels: ChannelConfig[];
  llm: {
    provider: 'ollama' | 'openai' | 'anthropic';
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
  call: {
    maxDepth: number;
    maxCalls: number;
    budgetUSD: number;
    timeoutMs: number;
  };
  dlq?: {
    type: 'file' | 'memory';
    path?: string;
    enableTools?: boolean;
  };
  audit?: {
    path?: string;
  };
  persistence?: {
    type: 'sqlite' | 'file';
    path?: string;
  };
  permissions?: {
    admins?: string[];
    users?: string[];
    agents?: string[];
    policy?: 'allow_all' | 'deny_all';
  };
  plugins?: string[];
}

const defaultConfig: CLIConfig = {
  rlm: {
    enabled: false
  },
  lcm: {
    enabled: false,
    compressionLevel: 'medium'
  },
  profiles: {},
  channels: [
    {
      type: 'nostr',
      relays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band'
      ]
    }
  ],
  llm: {
    provider: 'ollama',
    model: 'llama3.2'
  },
  call: {
    maxDepth: 4,
    maxCalls: 25,
    budgetUSD: 0.75,
    timeoutMs: 600000
  },
  dlq: {
    type: 'file',
    path: path.join(VOLTCLAW_DIR, 'dlq.json'),
    enableTools: false
  },
  audit: {
    path: path.join(VOLTCLAW_DIR, 'audit.jsonl')
  },
  persistence: {
    type: 'sqlite',
    path: path.join(VOLTCLAW_DIR, 'voltclaw.db')
  },
  permissions: {
    policy: 'allow_all'
  },
  plugins: []
};

export async function loadConfig(): Promise<CLIConfig> {
  let userConfig: Partial<CLIConfig> = {};

  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    userConfig = JSON.parse(content) as Partial<CLIConfig>;
  } catch {
    // No file, proceed with defaults
  }

  // Merge deeply? Or shallow.
  // Careful with arrays.

  // Start with default or user channels
  const channels = userConfig.channels || [...defaultConfig.channels];

  // Check ENV for tokens if not in config
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (process.env.TELEGRAM_TOKEN && !channels.some(c => c.type === 'telegram')) {
      channels.push({ type: 'telegram', token: process.env.TELEGRAM_TOKEN });
  }
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (process.env.DISCORD_TOKEN && !channels.some(c => c.type === 'discord')) {
      channels.push({ type: 'discord', token: process.env.DISCORD_TOKEN });
  }

  return {
    ...defaultConfig,
    ...userConfig,
    channels // Override channels with our logic
  };
}

export async function loadOrGenerateKeys(): Promise<{ publicKey: string; secretKey: string; npub?: string; nsec?: string }> {
  try {
    const content = await fs.readFile(KEYS_FILE, 'utf-8');
    return JSON.parse(content) as { publicKey: string; secretKey: string };
  } catch {
    const keys = await generateNewKeyPair();
    await fs.mkdir(VOLTCLAW_DIR, { recursive: true });
    await fs.writeFile(KEYS_FILE, JSON.stringify({
      publicKey: keys.publicKey,
      secretKey: keys.secretKey
    }, null, 2));
    console.log(`New identity created.`);
    console.log(`npub: ${keys.npub}`);
    console.log(`nsec: ${keys.nsec} (backup securely!)`);
    return { publicKey: keys.publicKey, secretKey: keys.secretKey, npub: keys.npub, nsec: keys.nsec };
  }
}

export { resolveToHex };
