// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Store, LLMProvider, PromptTemplate, PromptVersion } from './types.js';

export class PromptManager {
  private readonly store: Store;
  private readonly llm?: LLMProvider;

  constructor(store: Store, llm?: LLMProvider) {
    this.store = store;
    this.llm = llm;
  }

  async getPrompt(id: string, version?: number): Promise<string> {
    if (!this.store.getPromptTemplate) throw new Error('Store does not support prompt operations');

    const template = await this.store.getPromptTemplate(id);
    if (!template) {
      throw new Error(`Prompt template ${id} not found`);
    }

    const v = version ?? template.latestVersion;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const promptVersion = await this.store.getPromptVersion!(id, v);

    if (!promptVersion) {
      throw new Error(`Prompt version ${v} for ${id} not found`);
    }

    return promptVersion.content;
  }

  async createTemplate(id: string, description: string, initialContent: string): Promise<void> {
    if (!this.store.savePromptTemplate || !this.store.savePromptVersion) {
      throw new Error('Store does not support prompt operations');
    }

    const timestamp = Date.now();
    await this.store.savePromptTemplate({
      id,
      description,
      latestVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await this.store.savePromptVersion({
      templateId: id,
      version: 1,
      content: initialContent,
      changelog: 'Initial creation',
      createdAt: timestamp,
      metrics: { successCount: 0, failureCount: 0, avgCost: 0 }
    });
  }

  async updatePrompt(id: string, content: string, changelog: string): Promise<void> {
    if (!this.store.getPromptTemplate || !this.store.savePromptTemplate || !this.store.savePromptVersion) {
      throw new Error('Store does not support prompt operations');
    }

    const template = await this.store.getPromptTemplate(id);
    if (!template) {
      throw new Error(`Prompt template ${id} not found`);
    }

    const newVersion = template.latestVersion + 1;
    const timestamp = Date.now();

    await this.store.savePromptVersion({
      templateId: id,
      version: newVersion,
      content,
      changelog,
      createdAt: timestamp,
      metrics: { successCount: 0, failureCount: 0, avgCost: 0 }
    });

    await this.store.savePromptTemplate({
      ...template,
      latestVersion: newVersion,
      updatedAt: timestamp
    });
  }

  async optimizePrompt(id: string, feedback: string): Promise<string> {
    if (!this.llm) throw new Error('LLM required for prompt optimization');

    const currentContent = await this.getPrompt(id);

    const prompt = `Optimize the following prompt based on this feedback: "${feedback}".

    Original Prompt:
    """
    ${currentContent}
    """

    Return ONLY the optimized prompt content. Do not add conversational text.`;

    const response = await this.llm.chat([
      { role: 'system', content: 'You are a prompt engineering expert.' },
      { role: 'user', content: prompt }
    ]);

    return response.content;
  }

  async listTemplates(): Promise<PromptTemplate[]> {
      if (!this.store.listPromptTemplates) return [];
      return this.store.listPromptTemplates();
  }
}
