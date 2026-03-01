import { FileDLQ } from '../../core/dlq.js';
import { loadConfig } from '../config.js';

export async function dlqCommand(subcommand: string, id?: string): Promise<void> {
  const config = await loadConfig();
  const dlqConfig = config.dlq;

  if (dlqConfig === undefined || dlqConfig.type !== 'file' || dlqConfig.path === undefined || dlqConfig.path === '') {
    console.error('DLQ is not configured or not file-based.');
    return;
  }

  const dlq = new FileDLQ(dlqConfig.path);

  switch (subcommand) {
    case 'list': {
      const items = await dlq.list();
      if (items.length === 0) {
        console.log('DLQ is empty.');
      } else {
        console.log(`Found ${items.length} failed operations:`);
        for (const item of items) {
          console.log(`- [${item.id}] ${item.tool} (${item.timestamp.toISOString()})`);
          console.log(`  Error: ${item.error.slice(0, 100)}...`);
        }
      }
      break;
    }
    case 'show': {
      if (id === undefined || id === '') {
        console.error('Usage: voltclaw dlq show <id>');
        return;
      }
      const item = await dlq.get(id);
      if (!item) {
        console.error(`DLQ item not found: ${id}`);
        return;
      }
      console.log(JSON.stringify(item, null, 2));
      break;
    }
    case 'delete': {
      if (id === undefined || id === '') {
        console.error('Usage: voltclaw dlq delete <id>');
        return;
      }
      const item = await dlq.get(id);
      if (!item) {
        console.error(`DLQ item not found: ${id}`);
        return;
      }
      await dlq.remove(id);
      console.log(`Deleted DLQ item: ${id}`);
      break;
    }
    case 'clear': {
      const items = await dlq.list();
      if (items.length === 0) {
        console.log('DLQ is already empty.');
        return;
      }
      await dlq.clear();
      console.log(`Cleared ${items.length} items from DLQ.`);
      break;
    }
    default:
      console.log('Usage: voltclaw dlq <list|show|delete|clear> [id]');
      break;
  }
}
