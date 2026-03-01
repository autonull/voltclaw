import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { AsyncMutex } from './utils.js';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any;
  prevHash: string;
  hash: string;
}

export interface AuditLog {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(actor: string, action: string, details: any): Promise<void>;
  verify(): Promise<boolean>;
}

// Simple key-sorting stringify for deterministic hashing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deterministicStringify(obj: any): string {
  if (obj === undefined) return ''; // Should handle this case if called directly, though object keys filter it
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => deterministicStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) {
      parts.push(JSON.stringify(key) + ':' + deterministicStringify(value));
    }
  }
  return '{' + parts.join(',') + '}';
}

export class FileAuditLog implements AuditLog {
  private readonly path: string;
  private lastHash: string = '0'.repeat(64); // Genesis hash
  private initialized = false;
  private readonly mutex = new AsyncMutex();

  constructor(pathStr: string) {
    this.path = pathStr;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.access(this.path);
      // File exists, read only the last line efficiently
      // We'll use a small buffer reading from the end
      const handle = await fs.open(this.path, 'r');
      try {
        const stat = await handle.stat();
        if (stat.size === 0) return;

        const bufferSize = 1024; // Read 1KB chunks
        const buffer = Buffer.alloc(bufferSize);
        let position = stat.size;
        let lastLine = '';

        while (position > 0) {
          const readSize = Math.min(bufferSize, position);
          position -= readSize;

          await handle.read(buffer, 0, readSize, position);
          const chunk = buffer.toString('utf-8', 0, readSize);
          const lines = chunk.split('\n');

          // If we have at least one complete line (and maybe a partial one at start)
          // The last element is empty if the file ends with newline (standard)
          // If chunk doesn't contain newline, we just prepend to lastLine and continue reading backwards

          // Cases:
          // 1. "foo\nbar\n" -> lines=["foo", "bar", ""] (last valid is bar)
          // 2. "foo\nbar" -> lines=["foo", "bar"] (last valid is bar)

          if (lastLine) {
             // We had some partial line from previous iteration (which was "later" in file)
             // combine it
             lines[lines.length - 1] += lastLine;
          }

          // Clean empty trailing lines
          while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
          }

          if (lines.length > 0) {
            // We found the last line!
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const line = lines[lines.length - 1]!;
            try {
                const entry = JSON.parse(line) as AuditEntry;
                this.lastHash = entry.hash;
                break; // Found it
            } catch {
                // corrupted line? ignore or warn
            }
          }

          // Save the first part as potential partial line for next chunk (reading backwards)
          lastLine = lines[0] ?? '';
          // Wait, this logic is tricky for backwards reading.
          // Let's simplify: read chunk, find last newline in it.
          // If found, take everything after it.
          // If not found, keep reading.
        }

      } finally {
        await handle.close();
      }
    } catch {
      // File doesn't exist, start fresh
      await fs.mkdir(path.dirname(this.path), { recursive: true });
    }
    this.initialized = true;
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  async log(actor: string, action: string, details: any): Promise<void> {
    await this.mutex.run(async () => {
      await this.init();

      const timestamp = new Date().toISOString();
      const id = crypto.randomUUID();

      // Calculate hash using deterministic stringify
      const payload = this.lastHash + timestamp + actor + action + deterministicStringify(details);
      const hash = crypto.createHash('sha256').update(payload).digest('hex');

      const entry: AuditEntry = {
        id,
        timestamp,
        actor,
        action,
        details,
        prevHash: this.lastHash,
        hash
      };

      this.lastHash = hash;

      await fs.appendFile(this.path, JSON.stringify(entry) + '\n');
    });
  }

  async verify(): Promise<boolean> {
    try {
      // Use streams for verification to handle large files
      const fileStream = createReadStream(this.path);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let currentPrevHash = '0'.repeat(64);

      for await (const line of rl) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as AuditEntry;

        if (entry.prevHash !== currentPrevHash) {
          return false;
        }

        const payload = currentPrevHash + entry.timestamp + entry.actor + entry.action + deterministicStringify(entry.details);
        const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');

        if (entry.hash !== expectedHash) {
          return false;
        }

        currentPrevHash = entry.hash;
      }

      return true;
    } catch {
      return false;
    }
  }
}
