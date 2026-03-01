import type { Tool, ToolCallResult } from './types.js';

export interface CallToolConfig {
  onCall: (args: {
    task: string;
    summary?: string;
    schema?: Record<string, unknown> | string;
    depth: number;
  }) => Promise<ToolCallResult>;
  currentDepth: number;
  maxDepth: number;
}

export function createCallTool(config: CallToolConfig): Tool {
  return {
    name: 'call',
    description: 'Call a child agent to handle a sub-task. Use for complex tasks that can be parallelized or decomposed.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The specific task to call the child agent with'
        },
        summary: {
          type: 'string',
          description: 'Optional context summary for the child agent'
        },
        schema: {
          type: 'object',
          description: 'Optional JSON schema or description of the required output structure',
          properties: {} // Allow any object
        }
      },
      required: ['task']
    },
    maxDepth: config.maxDepth - 1,
    costMultiplier: 3,
    execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
      const task = String(args['task'] ?? '');
      const summary = args['summary'] !== undefined ? String(args['summary']) : undefined;
      const schema = args['schema'] as Record<string, unknown> | string | undefined;

      if (!task) {
        return { error: 'Task is required for call' };
      }

      return config.onCall({
        task,
        summary,
        schema,
        depth: config.currentDepth + 1
      });
    }
  };
}

export function createCallParallelTool(config: CallToolConfig): Tool {
  return {
    name: 'call_parallel',
    description: 'Call multiple independent tasks in parallel. Use when subtasks do not depend on each other.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string' },
              summary: { type: 'string' },
              schema: { type: 'object', description: 'Optional JSON schema' }
            },
            required: ['task']
          },
          description: 'List of tasks to call in parallel (max 10)'
        }
      },
      required: ['tasks']
    },
    maxDepth: config.maxDepth - 1,
    costMultiplier: 3,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
      // Note: The actual execution logic for parallel calls is complex and currently handled
      // inside VoltClawAgent.executeCallParallel directly.
      // This tool definition is mainly for schema purposes if used outside the agent context.
      return { error: 'Parallel calls should be handled by the agent core' };
    }
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export const estimateTokensTool: Tool = {
  name: 'estimate_tokens',
  description: 'Estimate the number of tokens in a text string (rough approximation)',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to estimate token count for'
      }
    },
    required: ['text']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const text = String(args['text'] ?? '');
    const tokens = estimateTokens(text);
    return { tokens, characters: text.length };
  }
};
