/**
 * TaskStore 单元测试 — SQLite CRUD 全面覆盖。
 *
 * 每个测试使用 :memory: DB 实现完全隔离。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TaskStore } from '../../src/server/task-store';
import { TaskStatus } from '../../src/server/app';

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(async () => {
    store = new TaskStore(':memory:');
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  // ─── 基础 CRUD ─────────────────────────────────────────────────

  describe('createTask + getTask', () => {
    it('should create a task and retrieve it by ID', async () => {
      await store.createTask('task-1', 'Build a bridge');
      const record = await store.getTask('task-1');

      expect(record).not.toBeNull();
      expect(record!.task_id).toBe('task-1');
      expect(record!.petition).toBe('Build a bridge');
      expect(record!.status).toBe(TaskStatus.PENDING);
      expect(record!.bill_state).toBe('petition');
      expect(record!.result).toBeNull();
      expect(record!.created_at).toBeTruthy();
      expect(record!.updated_at).toBeTruthy();
    });

    it('should return null for non-existent task', async () => {
      const record = await store.getTask('nonexistent');
      expect(record).toBeNull();
    });

    it('should throw on duplicate task_id', async () => {
      await store.createTask('dup-1', 'First');
      await expect(store.createTask('dup-1', 'Second')).rejects.toThrow();
    });
  });

  // ─── updateTask ────────────────────────────────────────────────

  describe('updateTask', () => {
    it('should update status', async () => {
      await store.createTask('task-u1', 'Test petition');
      await store.updateTask('task-u1', { status: TaskStatus.RUNNING });

      const record = await store.getTask('task-u1');
      expect(record!.status).toBe(TaskStatus.RUNNING);
    });

    it('should update result and bill_state together', async () => {
      await store.createTask('task-u2', 'Another petition');
      await store.updateTask('task-u2', {
        status: TaskStatus.COMPLETED,
        result: 'Success!',
        bill_state: 'act',
      });

      const record = await store.getTask('task-u2');
      expect(record!.status).toBe(TaskStatus.COMPLETED);
      expect(record!.result).toBe('Success!');
      expect(record!.bill_state).toBe('act');
    });

    it('should update updated_at timestamp', async () => {
      await store.createTask('task-u3', 'Timestamp test');
      const before = (await store.getTask('task-u3'))!.updated_at;

      // 小延迟保证时间戳不同
      await new Promise((r) => setTimeout(r, 10));
      await store.updateTask('task-u3', { status: TaskStatus.FAILED });

      const after = (await store.getTask('task-u3'))!.updated_at;
      expect(after).not.toBe(before);
    });

    it('should be a no-op when update is empty', async () => {
      await store.createTask('task-u4', 'Noop test');
      const before = (await store.getTask('task-u4'))!;
      await store.updateTask('task-u4', {});
      const after = (await store.getTask('task-u4'))!;
      expect(before.updated_at).toBe(after.updated_at);
    });

    it('should reject illegal column names (SQL injection defense)', async () => {
      await store.createTask('task-u5', 'Injection test');
      // 绕过 TS 类型，模拟运行时注入
      const malicious = { 'status = "hacked"; --': 'pwned' } as any;
      await expect(store.updateTask('task-u5', malicious)).rejects.toThrow('illegal column');
    });
  });

  // ─── countTasks + listTasks ────────────────────────────────────

  describe('countTasks + listTasks', () => {
    it('should count zero tasks initially', async () => {
      expect(await store.countTasks()).toBe(0);
    });

    it('should count tasks correctly after inserts', async () => {
      await store.createTask('t1', 'p1');
      await store.createTask('t2', 'p2');
      await store.createTask('t3', 'p3');
      expect(await store.countTasks()).toBe(3);
    });

    it('should list tasks in DESC order by updated_at', async () => {
      // 创建 3 个任务，确保时间戳有差异
      await store.createTask('oldest', 'p1');
      await new Promise((r) => setTimeout(r, 15));
      await store.createTask('middle', 'p2');
      await new Promise((r) => setTimeout(r, 15));
      await store.createTask('newest', 'p3');

      const all = await store.listTasks(0, 10);
      expect(all).toHaveLength(3);
      // DESC 排序：newest 在前
      expect(all[0].task_id).toBe('newest');
      expect(all[1].task_id).toBe('middle');
      expect(all[2].task_id).toBe('oldest');
    });

    it('should respect offset and limit for pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createTask(`page-${i}`, `petition-${i}`);
        await new Promise((r) => setTimeout(r, 10));
      }

      // total = 5, DESC 排序: page-4, page-3, page-2, page-1, page-0
      const page1 = await store.listTasks(0, 2);
      expect(page1).toHaveLength(2);
      expect(page1[0].task_id).toBe('page-4');
      expect(page1[1].task_id).toBe('page-3');

      const page2 = await store.listTasks(2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].task_id).toBe('page-2');
      expect(page2[1].task_id).toBe('page-1');

      const page3 = await store.listTasks(4, 2);
      expect(page3).toHaveLength(1);
      expect(page3[0].task_id).toBe('page-0');
    });

    it('should return empty array when offset exceeds total', async () => {
      await store.createTask('lone', 'only one');
      const result = await store.listTasks(10, 5);
      expect(result).toEqual([]);
    });
  });

  // ─── Events ────────────────────────────────────────────────────

  describe('storeEvent + getTaskEvents', () => {
    it('should store and retrieve events in insertion order', async () => {
      await store.createTask('ev-task', 'Event test');

      await store.storeEvent('ev-task', 'radical_mp', 'propose', 'angry', 0.8, '{"statement":"Let us fight!"}');
      await store.storeEvent('ev-task', 'conservative_mp', 'propose', 'calm', 0.3, '{"statement":"Let us be cautious."}');
      await store.storeEvent('ev-task', 'speaker', 'order', 'neutral', 0.5, '{"statement":"Order!"}');

      const events = await store.getTaskEvents('ev-task');
      expect(events).toHaveLength(3);

      // 按 id ASC 排序
      expect(events[0].source_agent).toBe('radical_mp');
      expect(events[0].action).toBe('propose');
      expect(events[1].source_agent).toBe('conservative_mp');
      expect(events[2].source_agent).toBe('speaker');
      expect(events[2].action).toBe('order');
    });

    it('should return empty array for task with no events', async () => {
      await store.createTask('no-events', 'Clean task');
      const events = await store.getTaskEvents('no-events');
      expect(events).toEqual([]);
    });

    it('should preserve payload as raw JSON string', async () => {
      await store.createTask('payload-test', 'Payload');
      const rawPayload = '{"conflict_score":0.75,"round_number":2}';
      await store.storeEvent('payload-test', 'radical_mp', 'propose', 'neutral', 0.5, rawPayload);

      const events = await store.getTaskEvents('payload-test');
      expect(events[0].payload).toBe(rawPayload);
    });
  });

  // ─── Acts ──────────────────────────────────────────────────────

  describe('storeAct + getTaskAct', () => {
    it('should store and retrieve act', async () => {
      await store.createTask('act-task', 'Act test');
      const actJson = '{"title":"Tax Reform Act","sections":[]}';
      await store.storeAct('act-task', actJson);

      const act = await store.getTaskAct('act-task');
      expect(act).not.toBeNull();
      expect(act!.act_json).toBe(actJson);
      expect(act!.created_at).toBeTruthy();
    });

    it('should return null when no act stored', async () => {
      await store.createTask('no-act', 'Test');
      expect(await store.getTaskAct('no-act')).toBeNull();
    });
  });

  // ─── Verdicts ──────────────────────────────────────────────────

  describe('storeVerdict + getTaskVerdict', () => {
    it('should store constitutional=true and retrieve as 1', async () => {
      await store.createTask('verd-1', 'Verdict test');
      await store.storeVerdict('verd-1', true, 'Approved', '["evidence1","evidence2"]');

      const verdict = await store.getTaskVerdict('verd-1');
      expect(verdict).not.toBeNull();
      expect(verdict!.constitutional).toBe(1);
      expect(verdict!.ruling).toBe('Approved');
      expect(verdict!.evidence).toBe('["evidence1","evidence2"]');
      expect(verdict!.created_at).toBeTruthy();
    });

    it('should store constitutional=false and retrieve as 0', async () => {
      await store.createTask('verd-2', 'Unconstitutional');
      await store.storeVerdict('verd-2', false, 'Rejected', '[]');

      const verdict = await store.getTaskVerdict('verd-2');
      expect(verdict!.constitutional).toBe(0);
      expect(verdict!.ruling).toBe('Rejected');
    });

    it('should return null when no verdict stored', async () => {
      await store.createTask('no-verd', 'Test');
      expect(await store.getTaskVerdict('no-verd')).toBeNull();
    });
  });

  // ─── PK 冲突 ────────────────────────────────────────────────────

  describe('UPSERT behavior (duplicate PK)', () => {
    it('should overwrite when storeAct is called twice for same task_id', async () => {
      await store.createTask('dup-act', 'Duplicate act');
      await store.storeAct('dup-act', '{"title":"First"}');
      await store.storeAct('dup-act', '{"title":"Second"}');
      const act = await store.getTaskAct('dup-act');
      expect(act!.act_json).toBe('{"title":"Second"}');
    });

    it('should overwrite when storeVerdict is called twice for same task_id', async () => {
      await store.createTask('dup-verd', 'Duplicate verdict');
      await store.storeVerdict('dup-verd', true, 'First ruling', '[]');
      await store.storeVerdict('dup-verd', false, 'Second ruling', '["new"]');
      
      const verdict = await store.getTaskVerdict('dup-verd');
      expect(verdict!.constitutional).toBe(0);
      expect(verdict!.ruling).toBe('Second ruling');
    });
  });

  // ─── 边界和生命周期 ────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should throw when operations run before initialize', async () => {
      const uninitStore = new TaskStore(':memory:');
      await expect(uninitStore.createTask('x', 'y')).rejects.toThrow('not initialized');
      // 不需要 close — 没有打开过
    });

    it('should be safe to close twice', async () => {
      const s = new TaskStore(':memory:');
      await s.initialize();
      await s.close();
      await s.close(); // 第二次应该无事发生
    });
  });

  // ─── 文件系统持久化 ─────────────────────────────────────────────

  describe('filesystem persistence', () => {
    it('should create DB file on disk and persist data across re-open', async () => {
      const dbPath = join(tmpdir(), `task-store-test-${randomUUID()}.db`);

      try {
        // 第一次打开：创建并写入数据
        const store1 = new TaskStore(dbPath);
        await store1.initialize();
        await store1.createTask('persist-1', 'Test persistence');
        await store1.close();

        expect(existsSync(dbPath)).toBe(true);

        // 第二次打开：数据应该仍然存在
        const store2 = new TaskStore(dbPath);
        await store2.initialize();
        const record = await store2.getTask('persist-1');
        expect(record).not.toBeNull();
        expect(record!.petition).toBe('Test persistence');
        await store2.close();
      } finally {
        // 清理测试文件
        try { unlinkSync(dbPath); } catch { /* ignore */ }
        try { unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
        try { unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
      }
    });
  });
});
