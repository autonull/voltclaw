/**
 * Hierarchical Context for LCM
 * 
 * Implements context inheritance chains where child contexts automatically
 * inherit all keys from parent contexts. This enables lossless context
 * propagation through recursive agent calls.
 * 
 * @example
 * ```typescript
 * // Create root context
 * const root = new HierarchicalContext();
 * root.set('project', 'VoltClaw');
 * root.set('goal', 'LCM integration');
 * 
 * // Create child context (inherits from root)
 * const child = root.createChild();
 * child.set('subtask', 'Implement context manager');
 * 
 * // Child can access both local and inherited data
 * console.log(child.get('project'));  // 'VoltClaw' (inherited)
 * console.log(child.get('subtask'));  // 'Implement context manager' (local)
 * ```
 */
export class HierarchicalContext {
  private parent?: HierarchicalContext;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private localData: Map<string, any> = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metadata: Map<string, any> = new Map();
  private readonly id: string;
  private createdAt: number;

  constructor(parent?: HierarchicalContext) {
    this.parent = parent;
    this.id = this.generateId();
    this.createdAt = Date.now();
  }

  /**
   * Set a value in local context
   * 
   * @param key - Key to set
   * @param value - Value to store
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: any): void {
    this.localData.set(key, value);
  }

  /**
   * Get a value, checking local then inherited context
   * 
   * @param key - Key to retrieve
   * @returns Value or undefined if not found
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(key: string): any {
    if (this.localData.has(key)) {
      return this.localData.get(key);
    }
    if (this.parent) {
      return this.parent.get(key);
    }
    return undefined;
  }

  /**
   * Check if a key exists in this context (local or inherited)
   * 
   * @param key - Key to check
   * @returns True if key exists
   */
  has(key: string): boolean {
    if (this.localData.has(key)) {
      return true;
    }
    if (this.parent) {
      return this.parent.has(key);
    }
    return false;
  }

  /**
   * Check if a key exists in local context only
   * 
   * @param key - Key to check
   * @returns True if key exists locally
   */
  hasLocal(key: string): boolean {
    return this.localData.has(key);
  }

  /**
   * Delete a key from local context
   * 
   * @param key - Key to delete
   * @returns True if deleted
   */
  delete(key: string): boolean {
    return this.localData.delete(key);
  }

  /**
   * Get all accessible keys (local + inherited)
   * 
   * @returns Set of all keys
   */
  getAllKeys(): Set<string> {
    const keys = new Set(this.localData.keys());
    if (this.parent) {
      for (const key of this.parent.getAllKeys()) {
        keys.add(key);
      }
    }
    return keys;
  }

  /**
   * Get only local keys
   * 
   * @returns Array of local keys
   */
  getLocalKeys(): string[] {
    return Array.from(this.localData.keys());
  }

  /**
   * Get all values as a flat object
   * 
   * Note: Local values override inherited values with same key
   * 
   * @returns Object with all key-value pairs
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAll(): Record<string, any> {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    
    // First collect inherited values
    if (this.parent) {
      Object.assign(result, this.parent.getAll());
    }
    
    // Then override with local values
    for (const [key, value] of this.localData.entries()) {
      result[key] = value;
    }
    
    return result;
  }

  /**
   * Get only local values
   * 
   * @returns Object with local key-value pairs
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLocal(): Record<string, any> {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const [key, value] of this.localData.entries()) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Create a child context that inherits from this one
   * 
   * @returns New child context
   */
  createChild(): HierarchicalContext {
    return new HierarchicalContext(this);
  }

  /**
   * Get the parent context (if any)
   * 
   * @returns Parent context or undefined
   */
  getParent(): HierarchicalContext | undefined {
    return this.parent;
  }

  /**
   * Get the root context in the hierarchy
   * 
   * @returns Root context
   */
  getRoot(): HierarchicalContext {
// eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: HierarchicalContext = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  /**
   * Get the depth in the hierarchy (0 = root)
   * 
   * @returns Depth level
   */
  getDepth(): number {
    let depth = 0;
    let current: HierarchicalContext | undefined = this.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  /**
   * Set metadata on this context
   * 
   * Metadata is not inherited to children
   * 
   * @param key - Metadata key
   * @param value - Metadata value
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  setMetadata(key: string, value: any): void {
    this.metadata.set(key, value);
  }

  /**
   * Get metadata from this context
   * 
   * @param key - Metadata key
   * @returns Metadata value or undefined
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMetadata(key: string): any {
    return this.metadata.get(key);
  }

  /**
   * Get all metadata
   * 
   * @returns Object with all metadata
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAllMetadata(): Record<string, any> {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const [key, value] of this.metadata.entries()) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Get the context ID
   * 
   * @returns Unique identifier
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the creation timestamp
   * 
   * @returns Unix timestamp in milliseconds
   */
  getCreatedAt(): number {
    return this.createdAt;
  }

  /**
   * Merge another context into this one
   * 
   * @param other - Context to merge from
   * @param override - Whether to override existing keys (default: false)
   */
  merge(other: HierarchicalContext, override: boolean = false): void {
    for (const [key, value] of other.localData.entries()) {
      if (override || !this.localData.has(key)) {
        this.localData.set(key, value);
      }
    }
  }

  /**
   * Extract a subset of context by keys
   * 
   * @param keys - Keys to extract
   * @returns New context with only specified keys
   */
  extract(keys: string[]): HierarchicalContext {
    const extracted = new HierarchicalContext();
    for (const key of keys) {
      if (this.has(key)) {
        extracted.set(key, this.get(key));
      }
    }
    return extracted;
  }

  /**
   * Convert to a plain object (for serialization)
   * 
   * @param includeInherited - Whether to include inherited values (default: true)
   * @returns Plain object representation
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  toJSON(includeInherited: boolean = true): Record<string, any> {
    return {
      id: this.id,
      depth: this.getDepth(),
      localKeys: this.getLocalKeys(),
      data: includeInherited ? this.getAll() : this.getLocal(),
      metadata: this.getAllMetadata(),
      createdAt: this.createdAt
    };
  }

  /**
   * Create a context from a plain object
   * 
   * @param data - Plain object with context data
   * @param parent - Optional parent context
   * @returns New HierarchicalContext
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  static fromJSON(data: Record<string, any>, parent?: HierarchicalContext): HierarchicalContext {
    const ctx = new HierarchicalContext(parent);
    
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (data.data) {
      for (const [key, value] of Object.entries(data.data)) {
        ctx.set(key, value);
      }
    }
    
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (data.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        ctx.setMetadata(key, value);
      }
    }
    
    return ctx;
  }

  /**
   * Get a visual representation of the context hierarchy
   * 
   * @returns String representation
   */
  visualize(): string {
    const lines: string[] = [];
    const indent = '  '.repeat(this.getDepth());
    
    lines.push(`${indent}Context[${this.id}] (depth: ${this.getDepth()})`);
    
    const localKeys = this.getLocalKeys();
    if (localKeys.length > 0) {
      lines.push(`${indent}  Local:`);
      for (const key of localKeys) {
        const value = this.localData.get(key);
        const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
        lines.push(`${indent}    ${key}: ${str.slice(0, 100)}${str.length > 100 ? '...' : ''}`);
      }
    }
    
    if (this.parent) {
      lines.push(this.parent.visualize());
    }
    
    return lines.join('\n');
  }

  /**
   * Clear all local data
   */
  clear(): void {
    this.localData.clear();
    this.metadata.clear();
  }

  /**
   * Get the number of local entries
   * 
   * @returns Number of local key-value pairs
   */
  size(): number {
    return this.localData.size;
  }

  /**
   * Iterate over local entries
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  forEach(callback: (key: string, value: any) => void): void {
    for (const [key, value] of this.localData.entries()) {
      callback(key, value);
    }
  }

  /**
   * Iterate over all entries (local + inherited)
   * 
   * Note: Local values are processed first, then inherited
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  forEachAll(callback: (key: string, value: any) => void): void {
    const processed = new Set<string>();
    
    // Process local first
    for (const [key, value] of this.localData.entries()) {
      callback(key, value);
      processed.add(key);
    }
    
    // Then inherited (skip already processed)
    if (this.parent) {
      this.parent.forEachAll((key, value) => {
        if (!processed.has(key)) {
          callback(key, value);
        }
      });
    }
  }

  private generateId(): string {
    return `hctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Context chain for tracking inheritance
 */
export interface ContextChain {
  contexts: HierarchicalContext[];
  root: HierarchicalContext;
  tip: HierarchicalContext;
}

/**
 * Create a context chain with a root context
 * 
 * @returns Context chain object
 */
export function createContextChain(): ContextChain {
  const root = new HierarchicalContext();
  return {
    contexts: [root],
    root,
    tip: root
  };
}

/**
 * Extend a context chain with a new child
 * 
 * @param chain - Existing chain
 * @returns New tip context
 */
export function extendChain(chain: ContextChain): HierarchicalContext {
  const child = chain.tip.createChild();
  chain.contexts.push(child);
  chain.tip = child;
  return child;
}

/**
 * Merge multiple contexts into a new one
 * 
 * @param contexts - Contexts to merge
 * @param override - Whether later contexts override earlier ones
 * @returns New merged context
 */
export function mergeContexts(
  contexts: HierarchicalContext[],
  override: boolean = true
): HierarchicalContext {
  const merged = new HierarchicalContext();
  
  for (const ctx of contexts) {
    merged.merge(ctx, override);
  }
  
  return merged;
}
