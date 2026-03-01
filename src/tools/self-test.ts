import type { Tool } from '../core/types.js';
import type { SelfTestFramework } from '../core/self-test.js';

export function createSelfTestTool(framework: SelfTestFramework): Tool {
  return {
    name: 'self_test',
    description: 'Generates and runs tests for a specific tool to verify its functionality.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The name of the tool to test (e.g. "time", "http_get")'
        }
      },
      required: ['target']
    },
    execute: async (args: Record<string, unknown>): Promise<{ result?: string; summary?: string; error?: string }> => {
      const target = args.target as string;
      try {
        const plan = await framework.generateTests(target);
        const report = await framework.runTests(plan);
        return {
          result: JSON.stringify(report, null, 2),
          summary: `Tests for ${report.tool}: ${report.passed}/${report.total} passed.`
        };
      } catch (error) {
        return { error: String(error) };
      }
    }
  };
}