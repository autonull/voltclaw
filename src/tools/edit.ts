import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolCallResult } from './types.js';

const EditSchema = z.object({
  path: z.string().describe('File to edit'),
  oldString: z.string().describe('Exact text to find and replace'),
  newString: z.string().describe('Replacement text'),
  replaceAll: z.boolean().optional().default(false).describe('Replace all occurrences')
});

export const editTool: Tool = {
  name: 'edit',
  description: 'Edit a file by replacing specific text. Use for targeted modifications without rewriting entire file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to edit' },
      oldString: { type: 'string', description: 'Exact text to find and replace' },
      newString: { type: 'string', description: 'Replacement text' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
    },
    required: ['path', 'oldString', 'newString']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const parsed = EditSchema.safeParse(args);
    if (!parsed.success) {
      return { error: `Invalid arguments: ${parsed.error.issues[0]?.message}` };
    }

    const { path, oldString, newString, replaceAll } = parsed.data;

    try {
      const content = await readFile(path, 'utf-8');

      // Check if oldString exists
      if (!content.includes(oldString)) {
        return { error: `Text not found in file: "${oldString.slice(0, 50)}..."` };
      }

      // Check for multiple occurrences when not using replaceAll
      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1 && !replaceAll) {
        return {
          error: `Found ${occurrences} occurrences. Use replaceAll: true to replace all, or provide more specific oldString.`
        };
      }

      // Perform replacement
      const updated = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      await writeFile(path, updated, 'utf-8');

      return {
        status: 'success',
        path,
        replacements: replaceAll ? occurrences : 1
      };
    } catch (error) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === 'ENOENT') {
        return { error: `File not found: ${path}` };
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).code === 'EACCES') {
        return { error: `Permission denied: ${path}` };
      }
      return { error: `Edit failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
};
