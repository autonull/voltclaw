import { z } from 'zod';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import type { Tool, ToolCallResult } from './types.js';

const GrepSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().default('.').describe('File or directory to search'),
  ignoreCase: z.boolean().optional().default(false).describe('Case insensitive'),
  include: z.string().optional().describe('Glob pattern for files to include (e.g., *.ts)'),
  maxMatches: z.number().optional().default(100).describe('Maximum matches to return')
});

interface GrepMatch {
  file: string;
  line: number;
  content: string;
  match: string;
}

export const grepTool: Tool = {
  name: 'grep',
  description: 'Search for regex patterns in files. Returns matching lines with file path and line number.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search (default: current directory)' },
      ignoreCase: { type: 'boolean', description: 'Case insensitive search' },
      include: { type: 'string', description: 'Glob pattern for files to include (e.g., *.ts)' },
      maxMatches: { type: 'number', description: 'Maximum matches to return (default: 100)' }
    },
    required: ['pattern']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const parsed = GrepSchema.safeParse(args);
    if (!parsed.success) {
      return { error: `Invalid arguments: ${parsed.error.issues[0]?.message}` };
    }

    const { pattern, path, ignoreCase, include, maxMatches } = parsed.data;

    try {
      const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
      const matches: GrepMatch[] = [];

      // Find files to search
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const pattern_ = include || '**/*';
      const files = await glob(pattern_, {
        cwd: path,
        nodir: true,
        ignore: ['node_modules/**', 'dist/**', '.git/**']
      });

      for (const file of files) {
        if (matches.length >= maxMatches) break;

        try {
          const content = await readFile(`${path}/${file}`, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
            const line = lines[i];
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!line) continue;
            const match = line.match(regex);
            if (match) {
              matches.push({
                file,
                line: i + 1,
                content: line.slice(0, 200),
                match: match[0]
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      return {
        matches,
        count: matches.length,
        truncated: matches.length >= maxMatches
      };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return { error: `Invalid regex pattern: ${pattern}` };
    }
  }
};
