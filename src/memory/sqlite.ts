import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import type {
  Store, Session, MemoryEntry, MemoryQuery,
  GraphNode, GraphEdge, GraphQuery,
  PromptTemplate, PromptVersion, ScheduledTask
} from '../core/types.js';
import { VOLTCLAW_DIR } from '../core/bootstrap.js';
import fs from 'fs';
import path from 'path';

export class SQLiteStore implements Store {
  private db?: Database;
  private cache: Map<string, Session> = new Map();
  private readonly dbPath: string;

  constructor(options: { path?: string } = {}) {
    this.dbPath = options.path ?? path.join(VOLTCLAW_DIR, 'voltclaw.db');

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async load(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT, -- JSON array of numbers
        tags TEXT, -- JSON array
        importance INTEGER,
        timestamp INTEGER NOT NULL,
        expires_at INTEGER,
        context_id TEXT,
        metadata TEXT -- JSON object
      );
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(source) REFERENCES graph_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(target) REFERENCES graph_nodes(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        latest_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompt_versions (
        template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        changelog TEXT,
        metrics TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (template_id, version),
        FOREIGN KEY(template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        task TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_run INTEGER,
        target TEXT
      );
    `);


    try {
      await this.db.exec('ALTER TABLE scheduled_tasks ADD COLUMN target TEXT');
    } catch {
      // Ignore if column already exists
    }

    try {
      await this.db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT');
    } catch {
      // Ignore if column already exists
    }


    try {
      await this.db.exec('ALTER TABLE memories ADD COLUMN level INTEGER DEFAULT 1');
    } catch {
      // Ignore if column already exists
    }

    try {
      await this.db.exec('ALTER TABLE memories ADD COLUMN last_access INTEGER');
    } catch {

      // Ignore if column already exists
    }

    try {
      await this.db.exec('ALTER TABLE memories ADD COLUMN expires_at INTEGER');
    } catch {
      // Ignore if column already exists
    }

    const rows = await this.db.all('SELECT key, data FROM sessions');
    for (const row of rows) {
      try {

        this.cache.set(row.key, JSON.parse(row.data));

      } catch {


        // ignore corrupt data
      }
    }
  }




// eslint-disable-next-line @typescript-eslint/no-unused-vars
  get(key: string, isSelf: boolean = false): Session {
    if (!this.cache.has(key)) {
      this.cache.set(key, {
        history: [],
        callCount: 0,
        estCostUSD: 0,
        actualTokensUsed: 0,
        subTasks: {},
        depth: 0,
        topLevelStartedAt: 0,
        sharedData: {}
      });

    }


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const session = this.cache.get(key)!;


    session.id = key;
    return session;
  }

  getAll(): Record<string, Session> {
    return Object.fromEntries(this.cache);
  }

  async save(): Promise<void> {



    if (!this.db) await this.load();



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const stmt = await this.db!.prepare(`
      INSERT INTO sessions (key, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
    `);









































// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type
    const replacer = (_key: string, value: any) => {


      if (_key === 'timer' || _key === 'resolve' || _key === 'reject') return undefined;
      return value;
    };

    for (const [key, session] of this.cache.entries()) {
      await stmt.run(key, JSON.stringify(session, replacer), Date.now());
    }
    await stmt.finalize();
  }

  clear(): void {

    this.cache.clear();
  }

  async createMemory(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
    if (!this.db) await this.load();


    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timestamp = Date.now();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO memories (id, type, level, last_access, content, embedding, tags, importance, timestamp, expires_at, context_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      entry.type,
      entry.level ?? 1,
      entry.lastAccess ?? timestamp,
      entry.content,
      entry.embedding ? JSON.stringify(entry.embedding) : null,
      JSON.stringify(entry.tags ?? []),
      entry.importance ?? 0,
      timestamp,
      entry.expiresAt ?? null,
      entry.contextId ?? null,
      JSON.stringify(entry.metadata ?? {})
    );


    return id;
  }

  async searchMemories(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.db) await this.load();




    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.id) {
      // Find the specific memory, OR any memory belonging to the same context (chunk set)
      sql += ' AND (id = ? OR context_id = ? OR context_id IN (SELECT context_id FROM memories WHERE id = ?))';

      params.push(query.id, query.id, query.id);
    }

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);

    }


    if (query.level !== undefined) {
      sql += ' AND level = ?';
      params.push(query.level);
    }



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.content) {
      sql += ' AND content LIKE ?';
      params.push(`%${query.content}%`);
    }


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.contextId) {
      sql += ' AND context_id = ?';
      params.push(query.contextId);
    }


    // Tag search in JSON array is tricky in standard sqlite without extensions
    // Simple naive check: LIKE '%"tag"%'
    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        sql += ' AND tags LIKE ?';
        // Use JSON.stringify to ensure we match the quoted string, avoiding partial matches
        // e.g. "apple" won't match "pineapple"
        const jsonTag = JSON.stringify(tag);
        // We strip the leading/trailing quotes from JSON.stringify because we're inside LIKE %...%
        // Actually, we WANT the quotes to ensure boundary.

        // JSON.stringify("apple") -> "apple"
        // So we search for %"apple"%
        params.push(`%${jsonTag}%`);
      }
    }


    // If query has embedding, we ignore default sort order and limit here,
    // because we need to fetch all candidates to compute similarity in memory
    // unless we combine it with other filters.

    // For now, if embedding is present, fetch ALL candidates matching other criteria

    // then sort by cosine similarity.




    if (!query.embedding) {

      sql += ' ORDER BY timestamp ASC'; // Default to chronological for streaming usually, or strict order

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (query.limit) {
        sql += ' LIMIT ?';
        params.push(query.limit);
      }




// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);


      }

    }



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all(sql, params);



    let entries = rows.map(row => ({

      id: row.id,
      type: row.type as MemoryEntry['type'],
      level: row.level ?? 1,
      lastAccess: row.last_access ?? row.timestamp,


      content: row.content,


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      tags: JSON.parse(row.tags || '[]'),


      importance: row.importance,
      timestamp: row.timestamp,
      expiresAt: row.expires_at,
      contextId: row.context_id,


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metadata: JSON.parse(row.metadata || '{}')
    }));

    if (query.embedding && query.embedding.length > 0) {
      entries = entries
        .map(entry => ({
          ...entry,

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          similarity: this.cosineSimilarity(query.embedding!, entry.embedding)

        }))
        .filter(e => e.similarity > -2) // Keep all, sort below
        .sort((a, b) => b.similarity - a.similarity);


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (query.limit) {
        entries = entries.slice(0, query.limit);

      }


      // Strip similarity for return type compatibility, or keep it if we change type
      // MemoryEntry doesn't have similarity, but it's fine to return extended objects usually.
    }

    return entries;
  }




  private cosineSimilarity(a: number[], b?: number[]): number {
    const vecB = b;
    if (!vecB || a.length !== vecB.length) return -1;
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {










// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      dot += a[i]! * vecB[i]!;








// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normA += a[i]! * a[i]!;










// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normB += vecB[i]! * vecB[i]!;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async updateMemory(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    if (!this.db) await this.load();



    const fields: string[] = [];
    const values: unknown[] = [];


    if (updates.type) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.level !== undefined) { fields.push('level = ?'); values.push(updates.level); }
    if (updates.lastAccess !== undefined) { fields.push('last_access = ?'); values.push(updates.lastAccess); }



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (updates.content) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.embedding) { fields.push('embedding = ?'); values.push(JSON.stringify(updates.embedding)); }
    if (updates.tags) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }

    if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(updates.importance); }
    if (updates.metadata) { fields.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }


    if (fields.length === 0) return;

    values.push(id);


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`, values);


  }

  async removeMemory(id: string): Promise<void> {



    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run('DELETE FROM memories WHERE id = ?', id);
  }





  async exportMemories(): Promise<MemoryEntry[]> {
    if (!this.db) await this.load();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all('SELECT * FROM memories ORDER BY timestamp ASC');
    return rows.map(row => ({
      id: row.id,
      type: row.type as MemoryEntry['type'],
      level: row.level ?? 1,
      lastAccess: row.last_access ?? row.timestamp,
      content: row.content,



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,




// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      tags: JSON.parse(row.tags || '[]'),
      importance: row.importance,
      timestamp: row.timestamp,

      expiresAt: row.expires_at,
      contextId: row.context_id,



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metadata: JSON.parse(row.metadata || '{}')
    }));
  }

  async consolidateMemories(): Promise<void> {
    if (!this.db) await this.load();



    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    const thirtyDays = 30 * oneDay;
    const ninetyDays = 90 * oneDay;

    // Delete expired memories


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?', now);

    // Level 1 (Recent) -> Level 2 (Working) if older than 24h



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      'UPDATE memories SET level = 2 WHERE level = 1 AND timestamp < ?',
      now - oneDay
    );



    // Level 2 (Working) -> Level 4 (Archived) if not accessed in 7 days and importance < 3

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      'UPDATE memories SET level = 4 WHERE level = 2 AND last_access < ? AND importance < 3',
      now - sevenDays
    );

    // Level 3 (Long-term) -> Level 4 (Archived) if not accessed in 30 days and importance < 5



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      'UPDATE memories SET level = 4 WHERE level = 3 AND last_access < ? AND importance < 5',

      now - thirtyDays
    );

    // Prune Level 4 (Archived) older than 90 days



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      'DELETE FROM memories WHERE level = 4 AND last_access < ?',
      now - ninetyDays
    );

    // Also keep the original size constraint as a fallback


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const countResult = await this.db!.get('SELECT COUNT(*) as count FROM memories');
    if (countResult.count > 5000) {
        // Delete oldest lowest importance items regardless of level (except maybe level 3?)



// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.db!.run('DELETE FROM memories WHERE importance < 2 AND id NOT IN (SELECT id FROM memories ORDER BY timestamp DESC LIMIT 2000)');
    }
  }

  // Graph Methods




  async addGraphNode(node: GraphNode): Promise<void> {
    if (!this.db) await this.load();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO graph_nodes (id, label, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      node.id,
      node.label,

      JSON.stringify(node.metadata ?? {}),

      node.createdAt,
      node.updatedAt
    );
  }

  async addGraphEdge(edge: GraphEdge): Promise<void> {
    if (!this.db) await this.load();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO graph_edges (id, source, target, relation, weight, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         weight = excluded.weight,
         metadata = excluded.metadata`,
      edge.id,
      edge.source,
      edge.target,
      edge.relation,

      edge.weight ?? 1.0,

      JSON.stringify(edge.metadata ?? {}),
      edge.createdAt
    );
  }



  async getGraphNode(id: string): Promise<GraphNode | undefined> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = await this.db!.get('SELECT * FROM graph_nodes WHERE id = ?', id);


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!row) return undefined;

    return {

      id: row.id,
      label: row.label,



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,

      updatedAt: row.updated_at
    };
  }


  async getGraphEdges(query: GraphQuery): Promise<GraphEdge[]> {
    if (!this.db) await this.load();


    let sql = 'SELECT * FROM graph_edges WHERE 1=1';
    const params: unknown[] = [];


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.source) {
      sql += ' AND source = ?';
      params.push(query.source);
    }

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.target) {

      sql += ' AND target = ?';
      params.push(query.target);
    }

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.relation) {


      sql += ' AND relation = ?';

      params.push(query.relation);
    }



// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }





// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all(sql, params);

    return rows.map(row => ({

      id: row.id,
      source: row.source,
      target: row.target,
      relation: row.relation,
      weight: row.weight,

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at
    }));

  }

  async searchGraphNodes(query: string): Promise<GraphNode[]> {
    if (!this.db) await this.load();
    // Simple substring search on ID or Label
    const sql = `
      SELECT * FROM graph_nodes
      WHERE id LIKE ? OR label LIKE ?
      LIMIT 20
    `;
    const pattern = `%${query}%`;

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all(sql, pattern, pattern);

    return rows.map(row => ({
      id: row.id,
      label: row.label,


// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,

      updatedAt: row.updated_at
    }));

  }

  // Prompt Methods

  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    if (!this.db) await this.load();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = await this.db!.get('SELECT * FROM prompt_templates WHERE id = ?', id);

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!row) return undefined;
    return {
      id: row.id,
      description: row.description,


      latestVersion: row.latest_version,
      createdAt: row.created_at,

      updatedAt: row.updated_at
    };
  }

  async savePromptTemplate(template: PromptTemplate): Promise<void> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO prompt_templates (id, description, latest_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         description = excluded.description,
         latest_version = excluded.latest_version,
         updated_at = excluded.updated_at`,
      template.id,

      template.description,
      template.latestVersion,
      template.createdAt,

      template.updatedAt
    );
  }

  async getPromptVersion(templateId: string, version: number): Promise<PromptVersion | undefined> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = await this.db!.get(
      'SELECT * FROM prompt_versions WHERE template_id = ? AND version = ?',
      templateId, version

    );

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!row) return undefined;
    return {
      templateId: row.template_id,
      version: row.version,
      content: row.content,
      changelog: row.changelog,

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      metrics: JSON.parse(row.metrics || '{}'),
      createdAt: row.created_at
    };
  }

  async savePromptVersion(version: PromptVersion): Promise<void> {
    if (!this.db) await this.load();


// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO prompt_versions (template_id, version, content, changelog, metrics, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id, version) DO UPDATE SET
         content = excluded.content,
         changelog = excluded.changelog,
         metrics = excluded.metrics`,
      version.templateId,
      version.version,
      version.content,
      version.changelog,
      JSON.stringify(version.metrics ?? {}),
      version.createdAt
    );

  }

  async listPromptTemplates(): Promise<PromptTemplate[]> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all('SELECT * FROM prompt_templates ORDER BY updated_at DESC');
    return rows.map(row => ({
      id: row.id,
      description: row.description,
      latestVersion: row.latest_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  // Scheduler Methods

  async scheduleTask(task: ScheduledTask): Promise<void> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run(
      `INSERT INTO scheduled_tasks (id, cron, task, created_at, last_run, target)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         cron = excluded.cron,
         task = excluded.task,
         last_run = excluded.last_run,
         target = excluded.target`,
      task.id,
      task.cron,
      task.task,
      task.createdAt,
      task.lastRun,
      task.target
    );
  }

  async getScheduledTasks(): Promise<ScheduledTask[]> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rows = await this.db!.all('SELECT * FROM scheduled_tasks ORDER BY created_at ASC');
    return rows.map(row => ({
      id: row.id,
      cron: row.cron,
      task: row.task,
      createdAt: row.created_at,
      lastRun: row.last_run,
      target: row.target
    }));
  }

  async deleteScheduledTask(id: string): Promise<void> {
    if (!this.db) await this.load();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.db!.run('DELETE FROM scheduled_tasks WHERE id = ?', id);
  }
}






