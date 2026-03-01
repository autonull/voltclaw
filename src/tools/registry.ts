import type { Tool, ToolCallResult, ToolDefinition, ToolParameters } from './types.js';

export type { Tool, ToolCallResult, ToolDefinition, ToolParameters };

export type ToolExecutor = (
  args: Record<string, unknown>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent?: any,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  session?: any,
  from?: string
) => Promise<ToolCallResult> | ToolCallResult;

interface RegisteredTool {
  name: string;
  handler: ToolExecutor;
  description: string;
  parameters?: ToolDefinition['parameters'];
  maxDepth: number;
  costMultiplier: number;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(tool: Tool): void;
  register(
    name: string,
    handler: ToolExecutor,
    description: string,
    maxDepth?: number,
    costMultiplier?: number
  ): void;
  
  register(
    toolOrName: Tool | string,
    handler?: ToolExecutor,
    description?: string,
    maxDepth?: number,
    costMultiplier?: number
  ): void {
    if (typeof toolOrName === 'string') {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!handler || !description) {
        throw new Error('Handler and description required when registering by name');
      }
      this.tools.set(toolOrName, {
        name: toolOrName,
        handler,
        description,
        maxDepth: maxDepth ?? Infinity,
        costMultiplier: costMultiplier ?? 1
      });
    } else {
      const tool = toolOrName;
      this.tools.set(tool.name, {
        name: tool.name,
        handler: tool.execute,
        description: tool.description,
        parameters: tool.parameters,
        maxDepth: tool.maxDepth ?? Infinity,
        costMultiplier: tool.costMultiplier ?? 1
      });
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listAll(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  listForDepth(depth: number): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(t => depth <= t.maxDepth)
      .map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Tool not found: ${name}` };
    }

    try {
      const result = await tool.handler(args);
      return result;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  clear(): void {
    this.tools.clear();
  }
}
