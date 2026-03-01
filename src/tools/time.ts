import type { Tool, ToolCallResult } from './types.js';

export const timeTool: Tool = {
  name: 'get_time',
  description: 'Get the current UTC time in ISO format',
  execute: async (): Promise<ToolCallResult> => {
    return { time: new Date().toISOString() };
  }
};

export const dateTool: Tool = {
  name: 'get_date',
  description: 'Get the current date and time with timezone information',
  execute: async (): Promise<ToolCallResult> => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      utc: now.toUTCString(),
      local: now.toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unix: Math.floor(now.getTime() / 1000)
    };
  }
};

export const sleepTool: Tool = {
  name: 'sleep',
  description: 'Pause execution for a specified number of milliseconds',
  parameters: {
    type: 'object',
    properties: {
      milliseconds: {
        type: 'number',
        description: 'Number of milliseconds to sleep'
      }
    },
    required: ['milliseconds']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolCallResult> => {
    const rawMs = args['milliseconds'];
    const ms = rawMs !== undefined && rawMs !== null ? Number(rawMs) : 0;
    if (ms < 0 || ms > 60000) {
      return { error: 'Milliseconds must be between 0 and 60000' };
    }
    await new Promise(resolve => setTimeout(resolve, ms));
    return { status: 'slept', milliseconds: ms };
  }
};
