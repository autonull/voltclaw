import { FileStore } from '../../memory/file-store.js';
import { SQLiteStore } from '../../memory/sqlite.js';
import { loadConfig, VOLTCLAW_DIR } from '../config.js';
import path from 'path';

async function getStore(): Promise<FileStore | SQLiteStore> {
  const config = await loadConfig();
  if (config.persistence?.type === 'file') {
    const store = new FileStore({ path: config.persistence.path !== undefined && config.persistence.path !== '' ? config.persistence.path : path.join(VOLTCLAW_DIR, 'data.json') });
    await store.load();
    return store;
  }
  const store = new SQLiteStore({ path: config.persistence?.path !== undefined && config.persistence.path !== '' ? config.persistence.path : path.join(VOLTCLAW_DIR, 'voltclaw.db') });
  await store.load();
  return store;
}

export async function schedulerCommand(subcommand: string, ...args: string[]): Promise<void> {
  const store = await getStore();

  if (store.getScheduledTasks === undefined || store.deleteScheduledTask === undefined) {
    console.error('Persistence store does not support scheduling.');
    return;
  }

  if (subcommand === 'list') {
    const tasks = await store.getScheduledTasks();
    if (tasks.length === 0) {
      console.log('No scheduled tasks found.');
      return;
    }
    console.log('Scheduled Tasks:');
    tasks.forEach(t => {
      console.log(`- [${t.id}] ${t.cron} : ${t.task} ${t.target !== undefined && t.target !== '' ? `(-> ${t.target})` : ''} (Last run: ${t.lastRun !== undefined && t.lastRun !== 0 && !Number.isNaN(t.lastRun) ? new Date(t.lastRun).toISOString() : 'Never'})`);
    });
  } else if (subcommand === 'cancel' || subcommand === 'delete') {
    const id = args[0];
    if (id === undefined || id === '') {
      console.error('Usage: voltclaw scheduler cancel <id>');
      return;
    }
    await store.deleteScheduledTask(id);
    console.log(`Task ${id} cancelled.`);
  } else {
    console.log('Usage: voltclaw scheduler [list|cancel]');
  }
}
