import { FileStore } from '../../memory/index.js';
import path from 'path';
import { VOLTCLAW_DIR } from '../config.js';

export async function sessionCommand(subcommand: string, arg?: string): Promise<void> {
  const store = new FileStore({ path: path.join(VOLTCLAW_DIR, 'data.json') });
  await store.load();

  switch (subcommand) {
    case 'list': {
      const all = store.getAll();
      const keys = Object.keys(all);

      if (keys.length === 0) {
        console.log('No active sessions found.');
        return;
      }

      console.log('\nActive Sessions:');
      console.log('----------------');
      for (const key of keys) {
        const session = all[key];
        if (session === undefined) continue;
        const msgCount = session.history.length;
        const subtaskCount = Object.keys(session.subTasks ?? {}).length;
        console.log(`- ${key}: ${msgCount} messages, ${subtaskCount} subtasks, cost: $${session.estCostUSD.toFixed(4)}`);
      }
      break;
    }

    case 'show': {
      if (arg === undefined || arg === '') {
        console.error('Usage: voltclaw session show <session_id>');
        return;
      }

      const session = store.get(arg, arg === 'self');
      if (session.history.length === 0 && Object.keys(session.subTasks).length === 0) {
        console.log(`Session '${arg}' is empty or does not exist.`);
        return;
      }

      console.log(`\nSession: ${arg}`);
      console.log('----------------');

      for (const msg of session.history) {
        const role = msg.role.toUpperCase();
        const content = msg.content !== undefined && msg.content !== null && msg.content !== '' ? msg.content.slice(0, 500) + (msg.content.length > 500 ? '...' : '') : '[no content]';
        console.log(`[${role}] ${content}`);
        if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
                console.log(`  [TOOL_CALL] ${tc.name}(${JSON.stringify(tc.arguments)})`);
            }
        }
      }
      break;
    }

    case 'clear': {
      store.clear();
      await store.save();
      console.log('All sessions cleared.');
      break;
    }

    case 'prune': {
        store.pruneAll();
        await store.save();
        console.log('Sessions pruned.');
        break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.log('Available subcommands: list, show <id>, clear, prune');
      break;
  }
}
