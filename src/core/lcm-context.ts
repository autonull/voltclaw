import type { Session } from './types.js';
import type { MemoryManager } from '../memory/manager.js';

/**
 * Reference to a context object stored in memory
 * 
 * LCM (Lossless Context Management) principle:
 * Instead of copying context data between agents, we store it once
 * and pass lightweight references. This prevents context loss and
 * reduces token usage in recursive operations.
 */
export interface ContextReference {
  /** Unique identifier for this reference */
  id: string;
  
  /** Keys that this reference points to */
  keys: string[];
  
  /** Session ID that owns this context */
  sessionId: string;
  
  /** When this reference was created */
  createdAt: number;
  
  /** Optional expiration time (ms since epoch) */
  expiresAt?: number;
  
  /** Number of times this reference has been resolved */
  accessCount: number;
  
  /** Optional metadata tags */
  tags?: string[];
}

/**
 * Compressed context data with memory references
 */
export interface CompressedContext {
  /** Context data with large values replaced by memory refs */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, string | any>;
  
  /** Map of keys to their memory IDs */
  largeValues: Record<string, string>;
  
  /** Original size in characters */
  originalSize: number;
  
  /** Compressed size in characters */
  compressedSize: number;
  
  /** Compression ratio */
  ratio: number;
}

/**
 * Options for creating context references
 */
export interface ContextReferenceOptions {
  /** Keys to include in the reference */
  keys: string[];
  
  /** Optional expiration time in milliseconds */
  expiresIn?: number;
  
  /** Optional tags for categorization */
  tags?: string[];
  
  /** Whether to automatically compress large values */
  compress?: boolean;
  
  /** Compression threshold in characters */
  compressionThreshold?: number;
}

/**
 * Options for resolving context references
 */
export interface ResolveContextOptions {
  /** Specific keys to resolve (defaults to all) */
  keys?: string[];
  
  /** Whether to decompress compressed values */
  decompress?: boolean;
  
  /** Whether to update access count */
  trackAccess?: boolean;
}

/**
 * LCM Context Reference Manager
 * 
 * Implements Lossless Context Management by:
 * 1. Storing context data once in shared memory
 * 2. Creating lightweight references for passing between agents
 * 3. Resolving references on-demand (lazy loading)
 * 4. Automatic garbage collection of expired references
 * 
 * @example
 * ```typescript
 * const manager = new ContextReferenceManager(memory, session);
 * 
 * // Create a reference to context data
 * const ref = await manager.createReference({
 *   keys: ['codebase', 'requirements', 'decisions'],
 *   expiresIn: 3600000, // 1 hour
 *   tags: ['analysis', 'project-x']
 * });
 * 
 * // Pass reference to sub-agent (lightweight!)
 * const result = await call_subagent({
 *   task: 'Analyze the code',
 *   contextRef: ref // Only ~50 tokens vs 5000+ for full context
 * });
 * 
 * // Resolve reference when needed
 * const context = await manager.resolveReference(ref);
 * ```
 */
export class ContextReferenceManager {
  private references: Map<string, ContextReference> = new Map();
  private readonly memory: MemoryManager;
  private readonly session: Session;
  
  // Compression settings
  private readonly compressionThreshold: number;
  private readonly enableCompression: boolean;

  constructor(
    memory: MemoryManager,
    session: Session,
    options: {
      compressionThreshold?: number;
      enableCompression?: boolean;
    } = {}
  ) {
    this.memory = memory;
    this.session = session;
    this.compressionThreshold = options.compressionThreshold ?? 1000;
    this.enableCompression = options.enableCompression ?? true;
  }

  /**
   * Create a reference to context data without copying it
   * 
   * This is the core LCM operation - instead of passing full context
   * to sub-agents, we store it once and pass a lightweight reference.
   * 
   * @param options - Reference creation options
   * @returns Reference ID string
   */
  async createReference(options: ContextReferenceOptions): Promise<string> {
    const refId = this.generateRefId();

    const ref: ContextReference = {
      id: refId,
      keys: options.keys,
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      sessionId: this.session.id!,
      createdAt: Date.now(),
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      expiresAt: options.expiresIn ? Date.now() + options.expiresIn : undefined,
      accessCount: 0,
      tags: options.tags || []
    };

    // Store context data in memory if compression is enabled
    if (this.enableCompression && options.keys.length > 0) {
      const contextData = this.extractContext(options.keys);
      
      // Compress if any values are large
      const shouldCompress = Object.values(contextData).some(v => {
        const str = typeof v === 'string' ? v : JSON.stringify(v);
        return str.length > this.compressionThreshold;
      });

      if (shouldCompress) {
        const compressed = await this.compressContext(contextData);
        await this.memory.storeMemory(
          JSON.stringify(compressed.data),
          'working',
          ['lcm_context', `ref:${refId}`, ...(options.tags || [])],
          8 // High importance
        );
      } else {
        // Store uncompressed for small contexts
        await this.memory.storeMemory(
          JSON.stringify(contextData),
          'working',
          ['lcm_context', `ref:${refId}`, ...(options.tags || [])],
          8
        );
      }
    }

    this.references.set(refId, ref);
    return refId;
  }

  /**
   * Resolve a context reference to actual data
   * 
   * This retrieves the context data that was stored when the reference
   * was created. Supports lazy loading - data is only fetched when needed.
   * 
   * @param refId - Reference ID to resolve
   * @param options - Resolution options
   * @returns Context data object
   */
  async resolveReference(
    refId: string,
    options: ResolveContextOptions = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<Record<string, any>> {
    const ref = this.references.get(refId);
    if (!ref) {
      throw new Error(`Context reference not found: ${refId}`);
    }

    // Check expiration
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (ref.expiresAt && Date.now() > ref.expiresAt) {
      throw new Error(`Context reference expired: ${refId}`);
    }

    // Track access if requested
    if (options.trackAccess !== false) {
      ref.accessCount++;
    }

    // Determine which keys to resolve
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const keysToResolve = options.keys?.length ? options.keys : ref.keys;

    // Retrieve from memory
    const memories = await this.memory.recall({
      tags: [`ref:${refId}`]
    });

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!memories || memories.length === 0) {
      // Fallback: try to extract from current session
      return this.extractContext(keysToResolve);
    }

    // Parse the stored context
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const contextData = JSON.parse(memories[0]!.content);

    // Decompress if needed
    if (options.decompress !== false && this.isCompressed(contextData)) {
      return this.decompressContext(contextData);
    }

    // Filter to requested keys
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const key of keysToResolve) {
      if (key in contextData) {
        result[key] = contextData[key];
      }
    }

    return result;
  }

  /**
   * Delete a context reference
   * 
   * @param refId - Reference ID to delete
   * @returns True if deleted, false if not found
   */
  deleteReference(refId: string): boolean {
    return this.references.delete(refId);
  }

  /**
   * Clean up expired references
   * 
   * Should be called periodically to prevent memory leaks
   * 
   * @param maxAge - Maximum age in milliseconds (default: 1 hour)
   * @returns Number of references cleaned
   */
  cleanup(maxAge: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [refId, ref] of this.references.entries()) {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const isExpired = ref.expiresAt && now > ref.expiresAt;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      const isOld = !ref.expiresAt && (now - ref.createdAt) > maxAge;

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (isExpired || isOld) {
        this.references.delete(refId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get statistics about managed references
   */
  getStats(): {
    totalReferences: number;
    totalAccesses: number;
    expiredReferences: number;
  } {
    const now = Date.now();
    let expired = 0;
    let totalAccesses = 0;

    for (const ref of this.references.values()) {
      totalAccesses += ref.accessCount;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (ref.expiresAt && now > ref.expiresAt) {
        expired++;
      }
    }

    return {
      totalReferences: this.references.size,
      totalAccesses,
      expiredReferences: expired
    };
  }

  /**
   * Extract context data from session
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractContext(keys: string[]): Record<string, any> {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};

    for (const key of keys) {
      // Try shared data first (RLM-style)
      if (this.session.sharedData?.[key] !== undefined) {
        result[key] = this.session.sharedData[key];
      }
      // Try session properties
      else if (key in this.session) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        result[key] = (this.session as any)[key];
      }
    }

    return result;
  }

  /**
   * Compress context by replacing large values with memory references
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async compressContext(context: Record<string, any>): Promise<CompressedContext> {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compressed: Record<string, string | any> = {};
    const largeValues: Record<string, string> = {};
    const originalSize = JSON.stringify(context).length;

    for (const [key, value] of Object.entries(context)) {
      const str = typeof value === 'string' ? value : JSON.stringify(value);

      if (str.length > this.compressionThreshold) {
        // Store large value in memory
        const memoryId = await this.memory.storeMemory(
          str,
          'working',
          ['lcm_compressed', key],
          7
        );
        compressed[key] = `mem:${memoryId}`;
        largeValues[key] = memoryId;
      } else {
        compressed[key] = value;
      }
    }

    const compressedSize = JSON.stringify(compressed).length;

    return {
      data: compressed,
      largeValues,
      originalSize,
      compressedSize,
      ratio: originalSize / (compressedSize || 1)
    };
  }

  /**
   * Decompress context by resolving memory references
   */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async decompressContext(compressed: CompressedContext | any): Promise<Record<string, any>> {
    const result = { ...compressed.data };

    for (const [key, memRef] of Object.entries(compressed.largeValues)) {
      const memories = await this.memory.recall({ id: memRef as string });
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (memories && memories.length > 0) {
        try {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          result[key] = JSON.parse(memories[0]!.content);
        } catch {
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          result[key] = memories[0]!.content;
        }
      }
    }

    return result;
  }

  /**
   * Check if context data is compressed
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isCompressed(data: any): data is CompressedContext {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    return data && typeof data === 'object' && 'largeValues' in data;
  }

  /**
   * Generate a unique reference ID
   */
  private generateRefId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Create LCM context tools
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createLCMTools(manager: ContextReferenceManager) {
  return [
    {
      name: 'context_create',
      description: 'Create a named context reference for efficient sharing between agents',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for this context'
          },
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Context keys to include in the reference'
          },
          expiresIn: {
            type: 'number',
            description: 'Expiration time in milliseconds (optional)'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization (optional)'
          }
        },
        required: ['name', 'keys']
      },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: Record<string, unknown>): Promise<any> => {
        const name = String(args['name']);
        const keys = Array.isArray(args['keys']) ? (args['keys'] as string[]) : [];
        const expiresIn = args['expiresIn'] as number | undefined;
        const tags = Array.isArray(args['tags']) ? (args['tags'] as string[]) : undefined;

        const refId = await manager.createReference({ keys, expiresIn, tags });
        return { refId, name, keys, expiresIn, tags };
      }
    },
    {
      name: 'context_resolve',
      description: 'Resolve a context reference to retrieve the actual data',
      parameters: {
        type: 'object',
        properties: {
          refId: {
            type: 'string',
            description: 'Context reference ID to resolve'
          },
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific keys to retrieve (optional, defaults to all)'
          },
          decompress: {
            type: 'boolean',
            description: 'Whether to decompress compressed values (default: true)'
          }
        },
        required: ['refId']
      },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: Record<string, unknown>): Promise<any> => {
        const refId = String(args['refId']);
        const keys = Array.isArray(args['keys']) ? args['keys'] as string[] : undefined;
        const decompress = args['decompress'] as boolean | undefined;

        try {
          const context = await manager.resolveReference(refId, { keys, decompress });
          return { success: true, context };
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    },
    {
      name: 'context_delete',
      description: 'Delete a context reference',
      parameters: {
        type: 'object',
        properties: {
          refId: {
            type: 'string',
            description: 'Context reference ID to delete'
          }
        },
        required: ['refId']
      },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: Record<string, unknown>): Promise<any> => {
        const refId = String(args['refId']);
        const deleted = manager.deleteReference(refId);
        return { success: deleted, refId };
      }
    },
    {
      name: 'context_stats',
      description: 'Get statistics about context references',
      parameters: {
        type: 'object',
        properties: {}
      },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (): Promise<any> => {
        return manager.getStats();
      }
    }
  ];
}
