import { type LLMProvider } from '../../core/index.js';
import { OllamaProvider, OpenAIProvider, AnthropicProvider } from '../../llm/index.js';
import { NostrClient } from '../../channels/nostr/index.js';
import { loadConfig, loadOrGenerateKeys, type CLIConfig } from '../config.js';
import { FileStore } from '../../memory/index.js';
import path from 'path';
import { VOLTCLAW_DIR } from '../config.js';

interface HealthCheck {
  name: string;
  healthy: boolean;
  message: string;
}

function createLLMProvider(config: CLIConfig['llm']): LLMProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider({
        model: config.model,
        baseUrl: config.baseUrl
      });
    case 'openai':
      return new OpenAIProvider({
        model: config.model,
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? ''
      });
    case 'anthropic':
      return new AnthropicProvider({
        model: config.model,
        apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
      });
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

async function checkLLM(config: CLIConfig['llm']): Promise<HealthCheck> {
  try {
    const llm = createLLMProvider(config);
    const start = Date.now();
    // Simple ping if possible, or just check instantiation.
    // Most LLM providers don't verify connection on init, so we might need a small chat request.
    // However, we want to be careful not to spend money or tokens just for a health check if possible.
    // But a health check implies verifying connectivity.
    // Let's try a very minimal prompt.
    await llm.chat([{ role: 'user', content: 'ping' }], { maxTokens: 5 });
    const latency = Date.now() - start;

    return {
      name: 'LLM',
      healthy: true,
      message: `${config.provider}/${config.model} (connected, ${latency}ms latency)`
    };
  } catch (error) {
    return {
      name: 'LLM',
      healthy: false,
      message: `${config.provider}/${config.model} - ${error instanceof Error ? error.message : 'unreachable'}`
    };
  }
}

async function checkChannel(config: CLIConfig): Promise<HealthCheck> {
  // Check first Nostr channel found
  const nostrConfig = config.channels?.find((c: { type: string; relays?: string[] }) => c.type === 'nostr');

  if (nostrConfig === undefined) {
     return {
         name: 'Channel',
         healthy: true,
         message: 'No Nostr channel configured (skipping)'
     };
  }

  const relays = nostrConfig.relays ?? ['wss://relay.damus.io'];

  try {
    const keys = await loadOrGenerateKeys();
    const channel = new NostrClient({ relays, privateKey: keys.secretKey });
    const start = Date.now();
    await channel.start();
    const latency = Date.now() - start;
    await channel.stop();

    return {
      name: 'Channel',
      healthy: true,
      message: `Nostr (${relays.length} relays connected, ${latency}ms latency)`
    };
  } catch (error) {
    return {
      name: 'Channel',
      healthy: false,
      message: `Nostr - ${error instanceof Error ? error.message : 'failed to connect'}`
    };
  }
}

async function checkStorage(): Promise<HealthCheck> {
  try {
    const store = new FileStore({ path: path.join(VOLTCLAW_DIR, 'data.json') });
    await store.load?.();
    const all = store.getAll();
    // Check if getAll returned undefined or null
    if (all === undefined || all === null) {
        throw new Error('getAll returned null/undefined');
    }
    return {
      name: 'Storage',
      healthy: true,
      message: `FileStore (${Object.keys(all).length} sessions loaded)`
    };
  } catch (error) {
    return {
      name: 'Storage',
      healthy: false,
      message: `FileStore - ${error instanceof Error ? error.message : 'failed to load'}`
    };
  }
}

export async function healthCommand(json: boolean): Promise<void> {
  const config = await loadConfig();
  const checks: HealthCheck[] = [];

  // LLM check
  const llmCheck = await checkLLM(config.llm);
  checks.push(llmCheck);

  // Channel check
  const channelCheck = await checkChannel(config);
  checks.push(channelCheck);

  // Storage check
  const storageCheck = await checkStorage();
  checks.push(storageCheck);

  if (json) {
    // We must ensure 'checks' are fully resolved if they contain promises, but here they are just objects.
    const output = JSON.stringify({ checks, healthy: checks.every(c => c.healthy) }, null, 2);
    console.log(output);
    return;
  }

  console.log('\nSystem Health Check:\n');
  for (const check of checks) {
    const icon = check.healthy ? '✓' : '✗';
    const color = check.healthy ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const reset = '\x1b[0m';
    console.log(`${color}${icon} ${check.name}${reset}: ${check.message}`);
  }

  const allHealthy = checks.every(c => c.healthy);
  console.log(allHealthy ? '\nAll systems healthy' : '\nSome systems have issues');
  process.exit(allHealthy ? 0 : 1);
}
