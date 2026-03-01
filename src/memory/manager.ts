import type { Store, MemoryEntry, MemoryQuery, LLMProvider } from '../core/types.js';
import { randomUUID } from 'crypto';

export class MemoryManager {
  private readonly store: Store;
  private readonly llm?: LLMProvider;

  constructor(store: Store, llm?: LLMProvider) {
    this.store = store;
    this.llm = llm;
  }

  async storeMemory(
    content: string,
    type: MemoryEntry['type'] = 'working',
    tags: string[] = [],
    importance: number = 1,
    level: number = 1,
    ttl?: number,
    chunkOptions: { size?: number; overlap?: number } = {}
  ): Promise<string> {
    if (!this.store.createMemory) {
      throw new Error('Store does not support memory operations');
    }

    const chunks = this.chunkText(content, chunkOptions.size, chunkOptions.overlap);
    const now = Date.now();
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const expiresAt = ttl ? now + ttl : undefined;

    if (chunks.length <= 1) {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      return this.createSingleMemory(chunks[0] || content, type, tags, importance, level, expiresAt);
    }

    const contextId = randomUUID();

    // Store all chunks
    await Promise.all(chunks.map(async (chunk, index) => {
      let embedding: number[] | undefined;
      if (this.llm?.embed) {
        try {
          embedding = await this.llm.embed(chunk);
        } catch (e) {
          console.error('Failed to generate embedding for chunk:', e);
        }
      }

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.store.createMemory!({
        content: chunk,
        type,
        tags,
        importance,
        embedding,
        level,
        lastAccess: now,
        expiresAt,
        contextId,
        metadata: {
          chunkIndex: index,
          totalChunks: chunks.length,
          originalLength: content.length
        }
      });
    }));

    return contextId;
  }

  private async createSingleMemory(
    content: string,
    type: MemoryEntry['type'],
    tags: string[],
    importance: number,
    level: number,
    expiresAt?: number
  ): Promise<string> {
    let embedding: number[] | undefined;
    if (this.llm?.embed) {
      try {
        embedding = await this.llm.embed(content);
      } catch (e) {
        console.error('Failed to generate embedding:', e);
      }
    }

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.store.createMemory!({
      content,
      type,
      tags,
      importance,
      embedding,
      level,
      lastAccess: Date.now(),
      expiresAt
    });
  }

  private chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      let endIndex = Math.min(startIndex + maxChunkSize, text.length);

      // If not at the end, try to find a sentence break to end this chunk
      if (endIndex < text.length) {
        // Look back up to 20% of chunk size or 200 chars
        const lookBack = Math.min(maxChunkSize * 0.2, 200);
        const boundarySearchStart = Math.max(startIndex, endIndex - lookBack);

        // Try finding paragraph breaks first
        const paragraphBreak = text.lastIndexOf('\n\n', endIndex);

        let bestBreak = -1;
        if (paragraphBreak > boundarySearchStart) {
          bestBreak = paragraphBreak + 2;
        } else {
            // Try sentence breaks
            const lastPeriod = text.lastIndexOf('. ', endIndex);
            const lastQuestion = text.lastIndexOf('? ', endIndex);
            const lastExclamation = text.lastIndexOf('! ', endIndex);
            const lastNewline = text.lastIndexOf('\n', endIndex);

            bestBreak = Math.max(lastPeriod, lastQuestion, lastExclamation);
            if (bestBreak !== -1 && bestBreak > boundarySearchStart) {
                 bestBreak += 2; // Include punctuation and space
            } else if (lastNewline > boundarySearchStart) {
                 bestBreak = lastNewline + 1;
            }
        }

        if (bestBreak !== -1) {
            endIndex = bestBreak;
        } else {
            // Fallback to space
            const lastSpace = text.lastIndexOf(' ', endIndex);
            if (lastSpace > boundarySearchStart) {
                endIndex = lastSpace + 1;
            }
        }
      }

      const chunk = text.slice(startIndex, endIndex);
      if (chunk.trim().length > 0) {
          chunks.push(chunk);
      }

      if (endIndex >= text.length) break;

      // Calculate next start index with overlap
      let nextStart = Math.max(startIndex + 1, endIndex - overlap);

      // Try to align nextStart with a word boundary
      if (nextStart > 0 && nextStart < endIndex) {
         const lastSpace = text.lastIndexOf(' ', nextStart);
         if (lastSpace > startIndex && lastSpace < endIndex) {
             nextStart = lastSpace + 1;
         }
      }

      startIndex = nextStart;
    }

    return chunks;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    if (!this.store.updateMemory) {
      throw new Error('Store does not support memory updates');
    }
    await this.store.updateMemory(id, updates);
  }

  async recall(query: string | MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.store.searchMemories) {
      return [];
    }

    const q: MemoryQuery = typeof query === 'string' ? { content: query } : { ...query };

    if (this.llm?.embed && !q.embedding) {
      const textToEmbed = q.content;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (textToEmbed) {
        try {
          q.embedding = await this.llm.embed(textToEmbed);
        } catch (e) {
          // Ignore embedding error, fallback to keyword search
          console.error('Failed to generate query embedding:', e);
        }
      }
    }

    const entries = await this.store.searchMemories(q);

    if (this.store.updateMemory) {
      // Async update lastAccess for all retrieved memories
      Promise.all(entries.map(e =>
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.store.updateMemory!(e.id, { lastAccess: Date.now() })
          .catch(() => {})
      )).catch(() => {});
    }

    return entries;
  }

  async forget(id: string): Promise<void> {
    if (!this.store.removeMemory) {
      throw new Error('Store does not support memory operations');
    }
    await this.store.removeMemory(id);
  }

  async export(): Promise<MemoryEntry[]> {
    if (!this.store.exportMemories) {
        throw new Error('Store does not support memory export');
    }
    return this.store.exportMemories();
  }

  async consolidate(): Promise<void> {
    if (!this.store.consolidateMemories) {
        throw new Error('Store does not support memory consolidation');
    }
    await this.store.consolidateMemories();
  }
}
