import { VOLTCLAW_DIR } from './bootstrap.js';
import fs from 'fs/promises';
import type { FSWatcher } from 'fs';
import path from 'path';
import { type Tool } from './types.js';

export class SkillLoader {
  private skillsDir: string;
  private eventHandlers: Map<string, Set<(tool: Tool) => void>> = new Map();
  private _watcher?: FSWatcher;

  constructor(skillsDir?: string) {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    this.skillsDir = skillsDir || path.join(VOLTCLAW_DIR, 'skills');
  }

  async ensureExists(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
  }

  async loadSkills(): Promise<Tool[]> {
    await this.ensureExists();
    const files = await fs.readdir(this.skillsDir);
    const tools: Tool[] = [];

    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        try {
          const filePath = path.join(this.skillsDir, file);
          const module = await import(filePath);
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (module.default && typeof module.default === 'object' && 'name' in module.default && 'execute' in module.default) {
            tools.push(module.default as Tool);
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          } else if (module.createTool && typeof module.createTool === 'function') {
             tools.push(module.createTool());
          }
        } catch (error) {
          console.error(`Failed to load skill ${file}:`, error);
        }
      }
    }
    return tools;
  }

  async installSkill(url: string, name?: string): Promise<string> {
    await this.ensureExists();

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch skill: ${response.statusText}`);
    }

    const content = await response.text();
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const filename = name ? (name.endsWith('.js') ? name : `${name}.js`) : path.basename(url);
    const filePath = path.join(this.skillsDir, filename);

    await fs.writeFile(filePath, content);
    return filename;
  }

  on(event: 'skillLoaded', handler: (tool: Tool) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: 'skillLoaded', handler: (tool: Tool) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: 'skillLoaded', tool: Tool): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(tool);
      }
    }
  }

  async startWatching(): Promise<void> {
    try {
      await this.ensureExists();
      
      const fsSync = await import('fs');
      this._watcher = fsSync.watch(this.skillsDir, async (eventType, filename) => {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (filename && (filename.endsWith('.js') || filename.endsWith('.ts'))) {
          if (eventType === 'rename' || eventType === 'change') {
            try {
              const filePath = path.join(this.skillsDir, filename);
              const exists = await fs.access(filePath).then(() => true).catch(() => false);
              if (exists) {
                const module = await import(filePath + '?t=' + Date.now());
                let tool: Tool | undefined;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                if (module.default && typeof module.default === 'object' && 'name' in module.default && 'execute' in module.default) {
                  tool = module.default as Tool;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                } else if (module.createTool && typeof module.createTool === 'function') {
                  tool = module.createTool();
                }
                if (tool) {
                  this.emit('skillLoaded', tool);
                }
              }
            } catch {
              // Silently ignore errors during hot reload
            }
          }
        }
      });
    } catch {
      // Watching is optional, don't fail if it doesn't work
    }
  }

  stopWatching(): void {
    if (this._watcher) {
      this._watcher.close();
    }
  }
}