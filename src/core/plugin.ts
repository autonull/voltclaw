import type { Tool, Middleware } from './types.js';
import type { VoltClawAgent } from './agent.js';
import type { LLMProvider } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LLMProviderFactory = (config: any) => LLMProvider;

export interface VoltClawPlugin {
  name: string;
  version: string;
  description?: string;

  // Lifecycle
  init?(agent: VoltClawAgent): Promise<void>;
  start?(agent: VoltClawAgent): Promise<void>;
  stop?(agent: VoltClawAgent): Promise<void>;

  // Contributions
  tools?: Tool[];
  middleware?: Middleware[];
  providers?: Record<string, LLMProviderFactory>;
}

export class PluginManager {
  private plugins: Map<string, VoltClawPlugin> = new Map();

  async load(pluginName: string): Promise<void> {
    try {
      const plugin = await import(pluginName);
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const pluginInstance = plugin.default || plugin;
      this.plugins.set(pluginName, pluginInstance);
    } catch (error) {
      throw new Error(`Failed to load plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  register(plugin: VoltClawPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  getTools(): Tool[] {
    return Array.from(this.plugins.values())
      .flatMap(p => p.tools || []);
  }

  getMiddleware(): Middleware[] {
    return Array.from(this.plugins.values())
      .flatMap(p => p.middleware || []);
  }

  async initAll(agent: VoltClawAgent): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.init?.(agent);
    }
  }

  async startAll(agent: VoltClawAgent): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.start?.(agent);
    }
  }

  async stopAll(agent: VoltClawAgent): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.stop?.(agent);
    }
  }
}
