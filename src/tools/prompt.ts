import type { Tool } from '../core/types.js';
import type { PromptManager } from '../core/prompt-manager.js';

export function createPromptTools(manager: PromptManager): Tool[] {
  return [
    {
      name: 'prompt_get',
      description: 'Get the content of a prompt template.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Template ID' },
          version: { type: 'number', description: 'Version number (optional, defaults to latest)' }
        },
        required: ['id']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const id = args.id as string;
        const version = args.version as number | undefined;
        try {
          const content = await manager.getPrompt(id, version);
          return { result: content };
        } catch (error) {
          return { error: String(error) };
        }
      }
    },
    {
      name: 'prompt_create',
      description: 'Create a new prompt template.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique Template ID' },
          description: { type: 'string', description: 'Description of the prompt purpose' },
          content: { type: 'string', description: 'Initial prompt content' }
        },
        required: ['id', 'description', 'content']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const id = args.id as string;
        const description = args.description as string;
        const content = args.content as string;
        try {
          await manager.createTemplate(id, description, content);
          return { result: `Prompt template ${id} created successfully.` };
        } catch (error) {
          return { error: String(error) };
        }
      }
    },
    {
      name: 'prompt_update',
      description: 'Update an existing prompt template with a new version.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Template ID' },
          content: { type: 'string', description: 'New prompt content' },
          changelog: { type: 'string', description: 'Description of changes' }
        },
        required: ['id', 'content', 'changelog']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const id = args.id as string;
        const content = args.content as string;
        const changelog = args.changelog as string;
        try {
          await manager.updatePrompt(id, content, changelog);
          return { result: `Prompt ${id} updated successfully.` };
        } catch (error) {
          return { error: String(error) };
        }
      }
    },
    {
      name: 'prompt_optimize',
      description: 'Use AI to suggest optimizations for a prompt based on feedback.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Template ID' },
          feedback: { type: 'string', description: 'Feedback or goals for optimization' }
        },
        required: ['id', 'feedback']
      },
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      execute: async (args: Record<string, unknown>) => {
        const id = args.id as string;
        const feedback = args.feedback as string;
        try {
          const optimized = await manager.optimizePrompt(id, feedback);
          return { result: optimized };
        } catch (error) {
          return { error: String(error) };
        }
      }
    }
  ];
}