import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { join } from 'path';

import type { Tool, ToolCallResult } from './types.js';
import { formatToolError } from './errors.js';

const FileSchema = z.object({
  path: z.string().describe('The path to the file')
});

const WriteFileSchema = FileSchema.extend({
  content: z.string().describe('The content to write to the file')
});

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The path to the file' }
    },
    required: ['path']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { path: filePath } = FileSchema.parse(args);
      const content = await readFile(filePath, 'utf-8');
      return { content };
    } catch (error) {
      return { error: formatToolError('read_file', error, args) };
    }
  }
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The path to the file' },
      content: { type: 'string', description: 'The content to write' }
    },
    required: ['path', 'content']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const { path: filePath, content } = WriteFileSchema.parse(args);
      await writeFile(filePath, content, 'utf-8');
      return { status: 'success', path: filePath };
    } catch (error) {
      return { error: formatToolError('write_file', error, args) };
    }
  }
};

export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files in a directory',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The directory path (default: current directory)' }
    }
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    try {
      const dirPath = (args.path as string) || '.';
      const fs = await import('fs/promises');
      const files = await fs.readdir(dirPath);
      return { files };
    } catch (error) {
      return { error: formatToolError('list_files', error, args) };
    }
  }
};
