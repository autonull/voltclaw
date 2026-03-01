import type { VoltClawAgent } from './agent.js';



// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ToolDefinition } from './types.js';

export interface TestCase {
  id: string;
  tool: string;
  description: string;
  input: Record<string, unknown>;
  expectedOutcome: 'success' | 'failure';
  expectedError?: string; // partial match
}

export interface TestPlan {
  tool: string;
  cases: TestCase[];
}

export interface TestResult {
  caseId: string;
  passed: boolean;
  actualOutcome: 'success' | 'failure';
  error?: string;
  output?: string;
  message?: string;
}

export interface TestReport {
  tool: string;
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

export class SelfTestFramework {
  constructor(private agent: VoltClawAgent) {}

  async generateTests(toolName: string): Promise<TestPlan> {
    // Ideally we fetch tool definition from agent. For now we assume LLM knows or we just pass name.

    const prompt = `Generate a test plan for the tool "${toolName}".
Return a JSON object with a "cases" array.
Each case should have:
- id: string
- description: string
- input: JSON object of arguments
- expectedOutcome: "success" or "failure"
- expectedError: optional string (if failure)

Generate 3 cases: 2 valid success cases, 1 invalid failure case (e.g. missing args).
Output valid JSON only.`;


    // Accessing private llm via any cast for now


// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llm = (this.agent as any).llm;

    const response = await llm.chat([
        { role: 'system', content: 'You are a QA engineer. Output valid JSON only.' },
        { role: 'user', content: prompt }
    ]);

    try {


        const jsonStr = response.content.replace(/```json\n?|\n?```/g, '').trim();

        const data = JSON.parse(jsonStr) as { cases: TestCase[] };
        return {

            tool: toolName,

// eslint-disable-next-line @typescript-eslint/no-explicit-any
            cases: data.cases.map((c: any) => ({
                id: c.id,

                tool: toolName,
                description: c.description,
                input: c.input,
                expectedOutcome: c.expectedOutcome,
                expectedError: c.expectedError
            }))





        };
    } catch (e) {
        throw new Error(`Failed to parse test plan: ${e}`);
    }
  }

  async runTests(plan: TestPlan): Promise<TestReport> {

    const results: TestResult[] = [];


    for (const testCase of plan.cases) {
        let actualOutcome: 'success' | 'failure' = 'success';

        let error: string | undefined;
        let output: string | undefined;

        try {
            // Use retryTool to execute safely (as self)
            const result = await this.agent.retryTool(testCase.tool, testCase.input);









































// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any
            if ((result as any).error) {



                actualOutcome = 'failure';


// eslint-disable-next-line @typescript-eslint/no-explicit-any
                error = (result as any).error;
            } else {
                actualOutcome = 'success';
                output = JSON.stringify(result);

            }
        } catch (e) {

            actualOutcome = 'failure';
            error = e instanceof Error ? e.message : String(e);
        }


        let passed = actualOutcome === testCase.expectedOutcome;


        // If we expected failure and got it, check error message if specified



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (passed && actualOutcome === 'failure' && testCase.expectedError) {


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!error?.toLowerCase().includes(testCase.expectedError.toLowerCase())) {
                passed = false; // Error mismatch
            }
        }

        results.push({



            caseId: testCase.id,
            passed,
            actualOutcome,
            error,
            output,

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            message: passed ? 'Passed' : `Expected ${testCase.expectedOutcome}, got ${actualOutcome}${error ? ': ' + error : ''}`
        });
    }

    return {
        tool: plan.tool,
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        results
    };
  }
}








































