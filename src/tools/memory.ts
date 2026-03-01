import type { Tool, MemoryEntry } from '../core/types.js';
import type { MemoryManager } from '../memory/manager.js';

export function createMemoryTools(manager: MemoryManager): Tool[] {
  return [
    {
      name: 'memory_store',
      description: 'Store a new memory in the long-term storage.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The content of the memory' },
          type: { type: 'string', enum: ['working', 'long_term', 'episodic'], description: 'Type of memory' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for retrieval' },
          importance: { type: 'number', description: 'Importance score (1-10)' }
        },
        required: ['content']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const id = await manager.storeMemory(
          args.content as string,
          (args.type as MemoryEntry['type']) ?? 'working',
          (args.tags as string[]) ?? [],
          (args.importance as number) ?? 1
        );
        return { status: 'stored', id };
      }
    },
    {
      name: 'memory_recall',
      description: 'Retrieve memories by semantic search or tags.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Query by specific memory ID' },
          query: { type: 'string', description: 'Text to search for' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          limit: { type: 'number', description: 'Max results' }
        }
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const results = await manager.recall({
          id: args.id as string | undefined,
          content: args.query as string | undefined,
          tags: args.tags as string[] | undefined,
          limit: (args.limit as number) ?? 5
        });
        return { status: 'found', count: results.length, results };
      }
    },
    {
      name: 'memory_forget',
      description: 'Remove a specific memory by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The ID of the memory to remove' }
        },
        required: ['id']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        await manager.forget(args.id as string);
        return { status: 'removed', id: args.id };
      }
    },
    {
      name: 'memory_export',
      description: 'Export all memories for backup or transfer.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async () => {
        const memories = await manager.export();
        return { status: 'exported', count: memories.length, memories };
      }
    },
    {
      name: 'memory_stream',
      description: 'Stream memories sequentially, useful for processing large datasets chunked in memory.',
      parameters: {
        type: 'object',
        properties: {
          contextId: { type: 'string', description: 'Context ID to stream chunks from' },
          limit: { type: 'number', description: 'Batch size (default 10)' },
          offset: { type: 'number', description: 'Offset for pagination' }
        },
        required: ['contextId']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args) => {
        const contextId = args.contextId as string;
        const limit = (args.limit as number) ?? 10;
        const offset = (args.offset as number) ?? 0;

        const results = await manager.recall({
          contextId,
          limit,
          offset
        });

        // Ensure we sort strictly by chunk index if available in metadata
        const sorted = results.sort((a, b) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            const idxA = (a.metadata as any)?.chunkIndex ?? 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            const idxB = (b.metadata as any)?.chunkIndex ?? 0;
            return idxA - idxB;
        });

        return {
            status: 'streamed',
            count: sorted.length,
            contextId,
            offset,
            memories: sorted
        };
      }
    },
    {
      name: 'memory_consolidate',
      description: 'Trigger memory optimization and cleanup. Summarizes recent working memories into long-term memory.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (_args, agent) => {
        // 1. Retrieve recent working memories
        const recentMemories = await manager.recall({ type: 'working', limit: 50 });

        // Cast agent to allow calling query (avoiding circular type import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const voltclaw = agent as any;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (recentMemories.length > 5 && voltclaw && typeof voltclaw.query === 'function') {
             const memoryContent = recentMemories.map(m => `- ${m.content} (importance: ${m.importance})`).join('\n');
             const prompt = `Consolidate these working memories into a single concise long-term memory summary. Focus on key facts and high importance items.\n\nMemories:\n${memoryContent}`;

             try {
                 // Use a specialized query or just standard query.
                 // Note: querying might trigger recursive calls or tools, which is fine but we want a direct answer.
                 const summary = await voltclaw.query(prompt);

                 // Store summary
                 await manager.storeMemory(
                     summary,
                     'long_term',
                     ['summary', 'consolidation'],
                     8 // High importance for summaries
                 );
             } catch (e) {
                 // Ignore LLM errors, proceed to pruning
                 console.error('Consolidation summary failed:', e);
             }
        }

        await manager.consolidate();
        return { status: 'consolidated', processed: recentMemories.length };
      }
    }
  ];
}
