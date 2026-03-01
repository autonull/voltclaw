import type { VoltClawAgent } from './agent.js';

export class DocumentationManager {
  constructor(private agent: VoltClawAgent) {}

  async generateToolDocumentation(toolName: string, sourceCode: string): Promise<string> {
    const prompt = `Generate comprehensive Markdown documentation for the tool "${toolName}".
Source code:
\`\`\`typescript
${sourceCode}
\`\`\`

Format:
# ${toolName}

## Description
[Clear description]

## Parameters
[Table or list of params]

## Usage Example
\`\`\`typescript
[Example call]
\`\`\`
`;

    // Accessing LLM directly or via query
    // Since this is a core component, we can use agent's internal LLM or query method.
    // Ideally we should use LLMProvider interface, but agent encapsulates it.
    // We can cast agent to accessing llm as done in SelfTestFramework or use query.
    // Using query might trigger other tools, which we don't want.
    // So casting is safer for "raw" LLM access in this context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llm = (this.agent as any).llm;

    const response = await llm.chat([
        { role: 'system', content: 'You are a technical writer.' },
        { role: 'user', content: prompt }
    ]);

    return response.content;
  }

  async generateCodeExplanation(sourceCode: string): Promise<string> {
    const prompt = `Explain the following code snippet concisely:
\`\`\`typescript
${sourceCode}
\`\`\`
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llm = (this.agent as any).llm;

    const response = await llm.chat([
        { role: 'system', content: 'You are a senior developer.' },
        { role: 'user', content: prompt }
    ]);

    return response.content;
  }
}
