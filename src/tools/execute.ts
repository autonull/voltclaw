import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolCallResult } from './types.js';

const execAsync = promisify(exec);

const ExecuteSchema = z.object({
  command: z.string().describe('Command to execute'),
  timeout: z.number().optional().default(30000).describe('Timeout in ms (default: 30000)'),
  cwd: z.string().optional().describe('Working directory')
});

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  />\s*\/dev\//,              // Writing to device files
  /mkfs/,                     // Format filesystem
  /dd\s+if=/,                 // dd commands
  /:\(\)\{.*:\};\s*:/,        // Fork bombs
];

export const executeTool: Tool = {
  name: 'execute',
  description: 'Execute a shell command. Use for running tests, git commands, npm scripts. Dangerous commands are blocked.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      cwd: { type: 'string', description: 'Working directory' }
    },
    required: ['command']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const parsed = ExecuteSchema.safeParse(args);
    if (!parsed.success) {
      return { error: `Invalid arguments: ${parsed.error.issues[0]?.message}` };
    }

    const { command, timeout, cwd } = parsed.data;

    // Safety check
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { error: `Command blocked for safety: matches dangerous pattern` };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd,
        maxBuffer: 1024 * 1024 * 10  // 10MB buffer
      });

      return {
        status: 'success',
        stdout: stdout.slice(0, 50000),  // Truncate if too long
        stderr: stderr.slice(0, 10000),
        truncated: stdout.length > 50000
      };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (error.killed) {
        return { error: `Command timed out after ${timeout}ms` };
      }
      return {
        error: `Command failed with exit code ${error.code}`,
        stdout: error.stdout?.slice(0, 10000),
        stderr: error.stderr?.slice(0, 10000)
      };
    }
  }
};
