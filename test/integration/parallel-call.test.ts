import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestHarness, MockLLM } from '../../src/testing/index.js';

describe('Parallel Call Integration', () => {
  let harness: TestHarness;

  afterEach(async () => {
    await harness?.stop();
  });

  it('calls multiple tasks in parallel', async () => {
    harness = new TestHarness({
      rlm: { enabled: true },
      relayPort: 40405,
      llm: new MockLLM({
        handler: async (messages) => {
            const last = messages[messages.length - 1];
            const content = last.content || '';

            if (content.includes('Parallel task')) {
                 return {
                    content: 'I will call two tasks.',
                    toolCalls: [
                        {
                            id: 'call_parallel',
                            name: 'call_parallel',
                            arguments: {
                                tasks: [
                                    { task: 'Task A', summary: 'Summary A' },
                                    { task: 'Task B', summary: 'Summary B' }
                                ]
                            }
                        }
                    ]
                };
            }

            // Subtask handling
            if (content.includes('Task:')) {
                if (content.includes('Task A')) {
                    return 'Result A';
                }
                if (content.includes('Task B')) {
                    return 'Result B';
                }
            }

            if (content.includes('Synthesize')) {
                return 'Combined result: A and B';
            }

            // Check for completed tool call response content
            if (content.includes('"result":"Result A"') && content.includes('"result":"Result B"')) {
                return 'Combined result: A and B';
            }

            return 'Mock response';
        }
      })
    });

    await harness.start();

    // Trigger call
    const response = await harness.agent.query('Parallel task');

    expect(response).toContain('Combined result: A and B');

    // Check session
    const session = harness.agent['store'].get('self', true);
    expect(session.callCount).toBe(2);

    const subtasks = Object.values(session.subTasks);
    expect(subtasks.length).toBe(2);
    expect(subtasks.find(s => s.task === 'Task A')?.result).toBe('Result A');
    expect(subtasks.find(s => s.task === 'Task B')?.result).toBe('Result B');
  });
});
