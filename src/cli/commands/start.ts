import { VoltClawAgent, type LLMProvider, type MessageContext, type ReplyContext, type ErrorContext } from '../../core/index.js';
import { OllamaProvider, OpenAIProvider, AnthropicProvider } from '../../llm/index.js';
import { FileStore } from '../../memory/index.js';
import { SQLiteStore } from '../../memory/sqlite.js';
import { createAllTools } from '../../tools/index.js';
import { loadConfig, loadOrGenerateKeys, VOLTCLAW_DIR, CONFIG_FILE } from '../config.js';
import { askApproval } from '../interactive.js';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// --- Helpers ---
// Ideally these would be shared but for now we duplicate or refactor CLI logic later.
// I will create a config.ts first to share these.

function createLLMProvider(config: { provider: string; model: string; baseUrl?: string; apiKey?: string }): LLMProvider {
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

async function checkLLMConnection(config: { provider: string; model: string; baseUrl?: string; apiKey?: string }): Promise<boolean> {
  if (config.provider === 'ollama') {
    const baseUrl = config.baseUrl !== undefined && config.baseUrl !== '' ? config.baseUrl : 'http://localhost:11434';
    try {
      // Simple ping to Ollama version endpoint
      const res = await fetch(`${baseUrl}/api/version`);
      if (!res.ok) throw new Error('Not OK');
      return true;

    } catch {
      console.error(`\n❌ Error: Could not connect to Ollama at ${baseUrl}`);
      console.error('   Please ensure Ollama is running: `ollama serve`');
      console.error('   Or update your config with `voltclaw configure`\n');
      return false;
    }
  }
  // For other providers, we assume they are online APIs.
  // Validation usually happens on first request.
  return true;
}

export async function startCommand(interactive: boolean = false, profile?: string): Promise<void> {
  // Check if config exists
  try {
    await fs.stat(CONFIG_FILE);
  } catch {
    console.warn('\n⚠️  Configuration file not found. Running with defaults.');
    console.warn('   Run `voltclaw configure` to set up your environment.\n');
  }

  let config = await loadConfig();
  if (profile !== undefined && profile !== '' && config.profiles?.[profile] !== undefined) {
    config = { ...config, ...config.profiles[profile] };
  }
  const keys = await loadOrGenerateKeys();

  console.log('Starting VoltClaw agent...');
  console.log(`Public key: ${keys.publicKey.slice(0, 16)}...`);

  if (!(await checkLLMConnection(config.llm))) {
    process.exit(1);
  }

  const llm = createLLMProvider(config.llm);

  // Use configured channels, injecting identity keys where needed
  const channels = (config.channels !== undefined && config.channels.length > 0 ? config.channels : [{ type: 'nostr' as const }]).map(c => {
    if (c.type === 'nostr' && c.privateKey === undefined) {
      return { ...c, privateKey: keys.secretKey };
    }
    // Stdio channel is handled by agent's resolveChannel
    return c;
  });

  let store: import('../../core/types.js').Store;

  if (config.persistence?.type === 'sqlite') {
    store = new SQLiteStore({ path: config.persistence.path });
  } else {
    // Default or 'file'
    const storePath = config.persistence?.path ?? path.join(VOLTCLAW_DIR, 'data.json');
    store = new FileStore({ path: storePath });
  }

  const tools = await createAllTools();

  let rl: readline.Interface | undefined;

  const agent = new VoltClawAgent({
    llm,
    channel: channels,
    persistence: store,
    call: config.call,
    plugins: config.plugins,
    tools,
    hooks: {
      onMessage: async (ctx: MessageContext): Promise<void> => {
        if (!interactive) {
          console.log(`[${new Date().toISOString()}] Message from ${ctx.from.slice(0, 8)}: ${ctx.content.slice(0, 100)}...`);
        }
      },
      onReply: async (ctx: ReplyContext): Promise<void> => {
        if (!interactive) {
          console.log(`[${new Date().toISOString()}] Reply to ${ctx.to.slice(0, 8)}: ${ctx.content.slice(0, 100)}...`);
        }
      },
      onError: async (ctx: ErrorContext): Promise<void> => {
        console.error(`[${new Date().toISOString()}] Error:`, ctx.error.message);
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      onToolApproval: interactive ? async (tool, args) => {
        if (rl) rl.pause();
        try {
          return await askApproval(tool, args);
        } finally {
          if (rl) rl.resume();
        }
      } : undefined
    }
  });

  // Set source dir for self-improvement
  // We need to resolve import.meta.url carefully if this file moves
  // Assuming src/cli/commands/start.ts -> up two levels -> src/cli -> up one -> src -> up one -> root
  // Wait, current file is src/cli/commands/start.ts
  // root is ../../..

  // Actually, let's keep it simple. If running from dist/cli/commands/start.js
  // dist/cli/commands/start.js -> .. -> dist/cli -> .. -> dist -> .. -> root
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  process.env.VOLTCLAW_SOURCE_DIR = path.resolve(currentDir, '../../..');

  await agent.start();

  if (interactive) {
    console.log('Interactive REPL mode. Type your query below.');
    console.log('Type "exit" to quit.');

    const repl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    rl = repl;

    repl.prompt();

    repl.on('line', async (line) => {
      const query = line.trim();
      if (query === 'exit') {
        repl.close();
        return;
      }
      if (query) {
        try {
          for await (const chunk of agent.queryStream(query)) {
            process.stdout.write(chunk);
          }
          process.stdout.write('\n');
        } catch (error) {
          console.error('Error:', error);
        }
      }
      repl.prompt();
    });

    repl.on('close', async () => {
      console.log('\nShutting down...');
      await agent.stop();
      process.exit(0);
    });

  } else {
    console.log('VoltClaw agent is running. Press Ctrl+C to stop.');
    // Keep process alive
    return new Promise(() => {
      process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await agent.stop();
          process.exit(0);
      });
    });
  }
}
