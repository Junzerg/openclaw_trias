/**
 * SQLite 任务持久化存储 — 翻译自 Python task_store.py。
 *
 * 使用 better-sqlite3 的同步 API，在 Node.js 单线程模型下性能最优。
 * 方法签名遵守 ITaskStore 接口（返回 Promise<T>），同步逻辑由 async 函数自动包装。
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type ITaskStore, type TaskRecord, TaskStatus } from './app';

/**
 * SQLite 持久化实现。
 *
 * 设计要点：
 * - 所有 JSON 字段（payload, act_json, evidence）原样存取字符串，不做解析假设。
 * - updateTask 动态构建 SET clause，自动追加 updated_at。
 * - listTasks 使用 ORDER BY updated_at DESC 并严格 (limit, offset) 参数顺序。
 */
export class TaskStore implements ITaskStore {
  private db: DatabaseType | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // 确保父目录存在
    if (this.dbPath !== ':memory:') {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // 极大提升 WAL 模式下的并发写入能力（写盘转交 OS 缓冲区）
    this.db.pragma('busy_timeout = 5000');  // 防止高并发时抛出 SQLITE_BUSY 导致 Node.js 进程奔溃
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id    TEXT PRIMARY KEY,
        petition   TEXT NOT NULL,
        status     TEXT NOT NULL,
        result     TEXT,
        bill_state TEXT NOT NULL DEFAULT 'petition',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      TEXT NOT NULL,
        timestamp    TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        action       TEXT NOT NULL,
        emotion      TEXT DEFAULT 'neutral',
        intensity    REAL DEFAULT 0.5,
        payload      TEXT DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS acts (
        task_id    TEXT PRIMARY KEY,
        act_json   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verdicts (
        task_id        TEXT PRIMARY KEY,
        constitutional INTEGER NOT NULL,
        ruling         TEXT NOT NULL,
        evidence       TEXT DEFAULT '[]',
        created_at     TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      )
    `);

    // Bug Fix: 清理僵尸任务 (Zombie Tasks)
    // 如果 Node.js 进程在执行期间意外崩溃 (如 OOM, SIGKILL, 宿主机断电)，
    // 内存中的队列会被清空，但数据库中残留的状态会永远卡在 PENDING 或 RUNNING。
    // 这会导致前端永久判定为“执行中”。在每次启动时，必须将这些悬空任务置为 FAILED。
    const now = new Date().toISOString();
    const info = this.db.prepare(`
      UPDATE tasks 
      SET status = ?, result = ?, updated_at = ?
      WHERE status IN (?, ?)
    `).run(
      TaskStatus.FAILED, 
      'Server unexpectedly terminated during execution (Zombie Task cleaned on startup)', 
      now, 
      TaskStatus.PENDING, 
      TaskStatus.RUNNING
    );

    if (info.changes > 0) {
      console.warn(`[TaskStore] Cleaned up ${info.changes} zombie task(s) on startup.`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * 获取已初始化的 DB 实例，未初始化时立即抛出错误。
   */
  private ensureDb(): DatabaseType {
    if (!this.db) {
      throw new Error('TaskStore not initialized. Call initialize() first.');
    }
    return this.db;
  }

  // ─── Tasks CRUD ────────────────────────────────────────────────

  async createTask(taskId: string, petition: string): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO tasks (task_id, petition, status, result, bill_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, petition, TaskStatus.PENDING, null, 'petition', now, now);
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      task_id: row.task_id as string,
      petition: row.petition as string,
      status: row.status as TaskStatus,
      result: (row.result as string) ?? null,
      bill_state: row.bill_state as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  /** updateTask 允许更新的列白名单 — 防止 TS 类型擦除后的 SQL 注入 */
  private static readonly UPDATABLE_COLUMNS = new Set(['status', 'result', 'bill_state']);

  async updateTask(
    taskId: string,
    update: Partial<Pick<TaskRecord, 'status' | 'result' | 'bill_state'>>,
  ): Promise<void> {
    const db = this.ensureDb();
    const entries = Object.entries(update).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const now = new Date().toISOString();
    // 动态构建 SET clause — 只更新明确传入的字段
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, val] of entries) {
      // 防御性白名单：阻止 TS 类型擦除后的非法列名注入
      if (!TaskStore.UPDATABLE_COLUMNS.has(key)) {
        throw new Error(`updateTask: illegal column "${key}"`);
      }
      setClauses.push(`${key} = ?`);
      values.push(val);
    }
    setClauses.push('updated_at = ?');
    values.push(now);
    values.push(taskId); // WHERE 子句参数

    const sql = `UPDATE tasks SET ${setClauses.join(', ')} WHERE task_id = ?`;
    db.prepare(sql).run(...values);
  }

  async countTasks(): Promise<number> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM tasks').get() as { cnt: number };
    return row.cnt;
  }

  async listTasks(offset: number, limit: number): Promise<TaskRecord[]> {
    const db = this.ensureDb();
    // 关键：ORDER BY updated_at DESC 保证最新任务在前
    // 参数绑定 (limit, offset) 对齐 SQL 的 LIMIT ? OFFSET ? 占位符
    const rows = db.prepare(
      'SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    ).all(limit, offset) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      task_id: row.task_id as string,
      petition: row.petition as string,
      status: row.status as TaskStatus,
      result: (row.result as string) ?? null,
      bill_state: row.bill_state as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }));
  }

  // ─── Events ────────────────────────────────────────────────────

  async storeEvent(
    taskId: string,
    sourceAgent: string,
    action: string,
    emotion: string,
    intensity: number,
    payload: string,
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO events (task_id, timestamp, source_agent, action, emotion, intensity, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, now, sourceAgent, action, emotion, intensity, payload);
  }

  async storeEventBatch(
    taskId: string,
    eventData: { sourceAgent: string, action: string, emotion: string, intensity: number, payloadStr: string },
    stateChange?: string,
    actJson?: string,
    verdict?: { constitutional: boolean, ruling: string, evidence: string }
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    // Bug 52 fix: Use SQLite transactions to prevent partial writes
    const tx = db.transaction(() => {
      // 1. insert event
      db.prepare(`
        INSERT INTO events (task_id, timestamp, source_agent, action, emotion, intensity, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(taskId, now, eventData.sourceAgent, eventData.action, eventData.emotion, eventData.intensity, eventData.payloadStr);

      // 2. update state
      if (stateChange) {
        db.prepare('UPDATE tasks SET bill_state = ?, updated_at = ? WHERE task_id = ?')
          .run(stateChange, now, taskId);
      }

      // 3. store act
      if (actJson) {
        db.prepare('INSERT OR REPLACE INTO acts (task_id, act_json, created_at) VALUES (?, ?, ?)')
          .run(taskId, actJson, now);
      }

      // 4. store verdict
      if (verdict) {
         db.prepare(`
          INSERT OR REPLACE INTO verdicts (task_id, constitutional, ruling, evidence, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(taskId, verdict.constitutional ? 1 : 0, verdict.ruling, verdict.evidence, now);
      }
    });

    tx();
  }

  async getTaskEvents(
    taskId: string,
  ): Promise<Array<{ action: string; source_agent: string; payload: string }>> {
    const db = this.ensureDb();
    const rows = db.prepare(
      'SELECT action, source_agent, payload FROM events WHERE task_id = ? ORDER BY id ASC',
    ).all(taskId) as Array<{ action: string; source_agent: string; payload: string }>;
    return rows;
  }

  // ─── Acts ──────────────────────────────────────────────────────

  async storeAct(taskId: string, actJson: string): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO acts (task_id, act_json, created_at) VALUES (?, ?, ?)
    `).run(taskId, actJson, now);
  }

  async getTaskAct(
    taskId: string,
  ): Promise<{ act_json: string; created_at: string } | null> {
    const db = this.ensureDb();
    const row = db.prepare('SELECT act_json, created_at FROM acts WHERE task_id = ?').get(taskId) as
      | { act_json: string; created_at: string }
      | undefined;
    return row ?? null;
  }

  // ─── Verdicts ──────────────────────────────────────────────────

  async storeVerdict(
    taskId: string,
    constitutional: boolean,
    ruling: string,
    evidence: string,
  ): Promise<void> {
    const db = this.ensureDb();
    const now = new Date().toISOString();

    // SQLite 没有 BOOLEAN 类型，存为 0/1 INTEGER
    db.prepare(`
      INSERT OR REPLACE INTO verdicts (task_id, constitutional, ruling, evidence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, constitutional ? 1 : 0, ruling, evidence, now);
  }

  async getTaskVerdict(
    taskId: string,
  ): Promise<{
    constitutional: number;
    ruling: string;
    evidence: string;
    created_at: string;
  } | null> {
    const db = this.ensureDb();
    const row = db.prepare(
      'SELECT constitutional, ruling, evidence, created_at FROM verdicts WHERE task_id = ?',
    ).get(taskId) as
      | { constitutional: number; ruling: string; evidence: string; created_at: string }
      | undefined;
    return row ?? null;
  }
}
