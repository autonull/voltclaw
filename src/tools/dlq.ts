import type { VoltClawAgent } from '../core/agent.js';
import type { Tool } from '../core/types.js';

export function createDLQTools(agent: VoltClawAgent): Tool[] {
  return [
    {
      name: 'dlq_list',
      description: 'List failed operations in the Dead Letter Queue (DLQ).',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async () => {
        const items = await agent.dlq.list();
        return {
          items: items.map(i => ({
            id: i.id,
            tool: i.tool,
            error: i.error,
            timestamp: i.timestamp.toISOString(),
            retryCount: i.retryCount
          })),
          count: items.length
        };
      }
    },
    {
      name: 'dlq_get',
      description: 'Get details of a specific failed operation from the DLQ.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the failed operation.'
          }
        },
        required: ['id']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const id = args.id as string;
        const item = await agent.dlq.get(id);
        if (!item) {
          return { error: `DLQ item not found: ${id}` };
        }
        return {
          item: {
            ...item,
            timestamp: item.timestamp.toISOString()
          }
        };
      }
    },
    {
      name: 'dlq_retry',
      description: 'Retry a failed operation from the DLQ.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the failed operation to retry.'
          }
        },
        required: ['id']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const id = args.id as string;
        const item = await agent.dlq.get(id);
        if (!item) {
          return { error: `DLQ item not found: ${id}` };
        }

        try {
          // Retry the tool execution
          // We assume the agent has a method to retry a tool call
          // If not, we can call executeTool if we can access it
          // Since we are inside the agent codebase (or close enough), we can rely on public methods
          // In the plan, I proposed adding `retryTool` to agent.

          const result = await agent.retryTool(item.tool, item.args);

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (result.error) {
             // If it fails again, it might go back to DLQ automatically via agent logic
             // But we should probably remove the OLD one if the new one is created?
             // Or update the retry count?
             // Currently agent.executeTool pushes to DLQ on failure.
             // So if we retry and fail, we get a NEW DLQ item.
             // So we should remove the OLD one regardless of outcome, OR keep it until success?
             // Usually, retry means "consume the message, try process, if fail, maybe dlq again".
             // So we should remove the old one.
             await agent.dlq.remove(id);
             return { status: 'failed_again', error: result.error, tool_output: result };
          }

          // Success
          await agent.dlq.remove(id);
          return { status: 'success', tool_output: result };

        } catch (error) {
          return { error: `Retry failed: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
    },
    {
      name: 'dlq_delete',
      description: 'Delete a failed operation from the DLQ.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The ID of the failed operation to delete.'
          }
        },
        required: ['id']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const id = args.id as string;
        await agent.dlq.remove(id);
        return { status: 'deleted', id };
      }
    },
    {
      name: 'dlq_clear',
      description: 'Clear all failed operations from the DLQ.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async () => {
        await agent.dlq.clear();
        return { status: 'cleared' };
      }
    }
  ];
}
