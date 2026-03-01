#!/usr/bin/env node

import { VoltClawAgent, type LLMProvider } from '../core/index.js';
import { OllamaProvider, OpenAIProvider, AnthropicProvider } from '../llm/index.js';
import { FileStore } from '../memory/index.js';
import { createAllTools } from '../tools/index.js';
import { loadConfig, loadOrGenerateKeys, VOLTCLAW_DIR } from './config.js';
import { startCommand } from './commands/start.js';
import { dmCommand } from './commands/dm.js';
import { healthCommand } from './commands/health.js';
import { sessionCommand } from './commands/session.js';
import { dlqCommand } from './commands/dlq.js';
import { configureCommand } from './commands/configure.js';
import { onboardCommand } from './commands/onboard.js';
import { schedulerCommand } from './commands/scheduler.js';
import { askApproval } from './interactive.js';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createLLMProvider(config: any): LLMProvider {
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

function printHelp(): void {
  console.log(`
VoltClaw - Recursive Autonomous Agent

Usage:
  voltclaw [command] [options]
  voltclaw "your query here"  # One-shot query mode

Commands:
  start               Start the agent daemon
  repl                Start interactive REPL (alias for start with interaction)
  configure           Run interactive configuration wizard
  onboard             Design agent persona (System Prompt)
  config [key] [val]  View or edit configuration
  keys                Show current identity
  dm <npub> <msg>     Send a direct message
  health              Run system health checks
  session [cmd]       Manage sessions (list, show, clear, prune)
  dlq [cmd]           Manage Dead Letter Queue (list, show, delete, clear)
  scheduler [cmd]     Manage Scheduled Tasks (list, cancel)
  version             Show version info
  help                Show this help message

Options:
  --recursive         Enable recursive calls for one-shot query
  --interactive       Enable interactive tool approval
  --verbose           Enable verbose logging
  --json              Output in JSON format (where applicable)
  --profile <name>    Use a specific configuration profile
`);
}

async function oneShotQuery(
  query: string,
  options: { recursive: boolean; verbose: boolean; debug: boolean; interactive: boolean; profile?: string }
): Promise<void> {
  let config = await loadConfig();
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (options.profile && config.profiles?.[options.profile]) {
    config = { ...config, ...config.profiles[options.profile] };
  }
  const keys = await loadOrGenerateKeys();
  const llm = createLLMProvider(config.llm);

  // Use configured channels, injecting identity keys where needed
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  const channels = (config.channels || [{ type: 'nostr' }]).map(c => {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (c.type === 'nostr' && !c.privateKey) {
      return { ...c, privateKey: keys.secretKey };
    }
    // Stdio channel is handled by agent's resolveChannel
    return c;
  });

  const store = new FileStore({ path: path.join(VOLTCLAW_DIR, 'data.json') });
  const tools = await createAllTools();

  const agent = new VoltClawAgent({
    llm,
    channel: channels,
    persistence: store,
    call: options.recursive ? config.call : { ...config.call, maxDepth: 1 },
    plugins: config.plugins,
    tools,
    hooks: {
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
       onCall: async (ctx) => {
         if (options.recursive) {
           const indicator = options.verbose ? ctx.task.slice(0, 60) : '';
           console.log(`  → [Depth ${ctx.depth}] Calling... ${indicator}`);
         }
       },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
       onToolApproval: options.interactive ? async (tool, args) => {
         return askApproval(tool, args);
       } : undefined
    }
  });

  if (options.verbose) {
    // Tool call logging can be implemented here if the agent emits 'tool_call' events.
  }

  await agent.start();

  try {
    console.log(`\n❯ ${query}\n`);
    for await (const chunk of agent.queryStream(query)) {
      process.stdout.write(chunk);
    }
    process.stdout.write('\n');
  } catch (error) {
    console.error("Error executing query:", error);
  } finally {
    await agent.stop();
  }
}

// --- Main Runner ---

async function run(args: string[]): Promise<void> {
  // Parse flags first
  let recursive = false;
  let verbose = false;
  let debug = false;
  let interactive = false;
  let json = false;
  let profile: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--recursive' || arg === '-r') {
      recursive = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--debug' || arg === '-d') {
      debug = true;
    } else if (arg === '--interactive' || arg === '-i') {
      interactive = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--profile') {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      profile = args[++i] || '';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    } else if (arg === '--version') {
      console.log('VoltClaw v1.0.0');
      return;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    } else if (arg && !arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const command = positional[0];

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!command) {
    printHelp();
    return;
  }

  // Handle known commands
  switch (command) {
    case 'start':
      await startCommand(false, profile);
      break;
    case 'repl':
      await startCommand(true, profile);
      break;
    case 'dm': {
      if (positional.length < 3) {
        console.error('Usage: voltclaw dm <npub/hex> <message>');
        process.exit(1);
      }

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      await dmCommand(positional[1] || '', positional[2] || '');
      break;
    }
    case 'health': {
      await healthCommand(json);
      break;
    }
    case 'session': {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      await sessionCommand(positional[1] || 'list', positional[2]);
      break;
    }
    case 'dlq': {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      await dlqCommand(positional[1] || 'list', positional[2]);
      break;
    }
    case 'scheduler': {

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      await schedulerCommand(positional[1] || 'list', positional[2] || '');
      break;
    }
    case 'keys': {
      const keys = await loadOrGenerateKeys();
      console.log('Current identity:');
      console.log(`  Public key: ${keys.publicKey}`);
      break;
    }
    case 'configure': {
      await configureCommand();
      break;
    }
    case 'onboard': {
      await onboardCommand();
      break;
    }
    case 'config': {
      const config = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
      break;
    }
    case 'version':
      console.log('VoltClaw v1.0.0');
      break;
    default:
      // Treat as one-shot query
// eslint-disable-next-line no-case-declarations
      const query = positional.join(' ');
      await oneShotQuery(query, { recursive, verbose, debug, interactive, profile });
      break;
  }
}

// --- Entry Point ---

if (import.meta.url === `file://${process.argv[1]}`) {
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  (async () => {
    try {
        await run(process.argv.slice(2));
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
  })();
}
