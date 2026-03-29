/**
 * Unit tests for REST API routes.
 *
 * Uses supertest to test Express endpoints with mock AppState.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp, AppState, TaskStatus, TaskRecord, ITaskStore, ITaskQueue, IConnectionManager } from '../../src/server/app';
import { CyberGovernment } from '../../src/government';

// ─── In-memory mock implementations ─────────────────────────────

class MockTaskStore implements ITaskStore {
  private tasks: Map<string, TaskRecord> = new Map();
  private acts: Map<string, { act_json: string; created_at: string }> = new Map();
  private events: Map<string, Array<{ action: string; source_agent: string; payload: string }>> = new Map();
  private verdicts: Map<string, { constitutional: number; ruling: string; evidence: string; created_at: string }> = new Map();

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async createTask(taskId: string, petition: string): Promise<void> {
    const now = new Date().toISOString();
    this.tasks.set(taskId, {
      task_id: taskId,
      petition,
      status: TaskStatus.PENDING,
      bill_state: 'drafting',
      result: null,
      created_at: now,
      updated_at: now,
    });
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateTask(taskId: string, update: Partial<Pick<TaskRecord, 'status' | 'result' | 'bill_state'>>): Promise<void> {
    const existing = this.tasks.get(taskId);
    if (existing) {
      Object.assign(existing, update, { updated_at: new Date().toISOString() });
    }
  }

  async countTasks(): Promise<number> {
    return this.tasks.size;
  }

  async listTasks(offset: number, limit: number): Promise<TaskRecord[]> {
    return Array.from(this.tasks.values()).slice(offset, offset + limit);
  }

  async getTaskAct(taskId: string): Promise<{ act_json: string; created_at: string } | null> {
    return this.acts.get(taskId) ?? null;
  }

  async getTaskEvents(taskId: string): Promise<Array<{ action: string; source_agent: string; payload: string }>> {
    return this.events.get(taskId) ?? [];
  }

  async getTaskVerdict(taskId: string): Promise<{ constitutional: number; ruling: string; evidence: string; created_at: string } | null> {
    return this.verdicts.get(taskId) ?? null;
  }

  // ─── Test helpers ─────────────────────────────────────────────

  seedAct(taskId: string, act: Record<string, unknown>): void {
    this.acts.set(taskId, { act_json: JSON.stringify(act), created_at: new Date().toISOString() });
  }

  seedEvents(taskId: string, events: Array<{ action: string; source_agent: string; payload: string }>): void {
    this.events.set(taskId, events);
  }

  seedVerdict(taskId: string, data: { constitutional: number; ruling: string; evidence: string }): void {
    this.verdicts.set(taskId, { ...data, created_at: new Date().toISOString() });
  }

  // ─── Write methods (stub for ITaskStore compliance) ────────────

  async storeEvent(_taskId: string, _sourceAgent: string, _action: string, _emotion: string, _intensity: number, _payload: string): Promise<void> {}
  async storeAct(_taskId: string, _actJson: string): Promise<void> {}
  async storeVerdict(_taskId: string, _constitutional: boolean, _ruling: string, _evidence: string): Promise<void> {}
}

class MockTaskQueue implements ITaskQueue {
  async submit(_taskId: string, _taskFactory: () => Promise<void>): Promise<void> {}
}

class MockConnectionManager implements IConnectionManager {
  connect(_taskId: string, _ws: import('ws').WebSocket): void {}
  disconnect(_taskId: string, _ws: import('ws').WebSocket): void {}
  async broadcast(_taskId: string, _payload: Record<string, unknown>): Promise<void> {}
  getConnectionCount(_taskId: string): number { return 0; }
}

// ─── Test setup ───────────────────────────────────────────────

function createTestApp() {
  const store = new MockTaskStore();

  const state: AppState = {
    government: {} as CyberGovernment,  // not used by routes
    taskStore: store,
    taskQueue: new MockTaskQueue(),
    wsManager: new MockConnectionManager(),
  };

  const app = createApp(state);
  return { app, store };
}

// ─── Tests ────────────────────────────────────────────────────

describe('REST API Routes', () => {
  // ─── POST /petition ────────────────────────────────────────

  describe('POST /petition', () => {
    it('should return 202 with task_id for valid prompt', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({ prompt: '帮我写一个 TODO App' })
        .expect(202);

      expect(res.body).toHaveProperty('task_id');
      expect(res.body.status).toBe('pending');
      expect(res.body.message).toBe('请愿已提交，三权状态机已启动');
      expect(typeof res.body.task_id).toBe('string');
      expect(res.body.task_id.length).toBeGreaterThan(0);
    });

    it('should return 400 when prompt is missing', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Bad Request');
    });

    it('should return 400 when prompt is empty string', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({ prompt: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Bad Request');
    });

    it('should return 400 when prompt is purely whitespaces', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({ prompt: '   \n   ' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Bad Request');
      expect(res.body.detail).toContain('选民请愿内容不能为空');
    });

    it('should store the task in the store', async () => {
      const { app, store } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({ prompt: '测试请愿' })
        .expect(202);

      const task = await store.getTask(res.body.task_id);
      expect(task).not.toBeNull();
      expect(task!.petition).toBe('测试请愿');
      expect(task!.status).toBe(TaskStatus.PENDING);
    });

    it('should return 400 when prompt is a number instead of string', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .send({ prompt: 123 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Bad Request');
    });

    it('should return 400 for non-JSON content type', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .set('Content-Type', 'text/plain')
        .send('raw text body')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Bad Request');
    });

    it('should return 400 for malformed JSON syntax', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/petition')
        .set('Content-Type', 'application/json')
        .send('{ bad json:')
        .expect(400);

      expect(res.body.error).toBe('Bad Request');
      expect(res.body.detail).toBeDefined();
    });
  });

  // ─── GET /task/:id/status ──────────────────────────────────

  describe('GET /task/:id/status', () => {
    it('should return task status for existing task', async () => {
      const { app, store } = createTestApp();
      await store.createTask('test-123', '测试请愿');

      const res = await request(app)
        .get('/task/test-123/status')
        .expect(200);

      expect(res.body.task_id).toBe('test-123');
      expect(res.body.petition).toBe('测试请愿');
      expect(res.body.status).toBe('pending');
      expect(res.body.bill_state).toBe('drafting');
      expect(res.body.result).toBeNull();
      expect(res.body).toHaveProperty('created_at');
      expect(res.body).toHaveProperty('updated_at');
    });

    it('should return 404 for non-existent task', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/task/non-existent/status')
        .expect(404);

      expect(res.body).toHaveProperty('detail', 'Task not found');
    });

    it('should reflect updated status and result', async () => {
      const { app, store } = createTestApp();
      await store.createTask('upd-1', '更新测试');
      await store.updateTask('upd-1', { status: TaskStatus.COMPLETED, result: '执行完成' });

      const res = await request(app)
        .get('/task/upd-1/status')
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.result).toBe('执行完成');
    });
  });

  // ─── GET /tasks ────────────────────────────────────────────

  describe('GET /tasks', () => {
    it('should return empty list when no tasks', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/tasks')
        .expect(200);

      expect(res.body).toEqual({
        total: 0,
        offset: 0,
        limit: 20,
        tasks: [],
      });
    });

    it('should return tasks with pagination', async () => {
      const { app, store } = createTestApp();
      await store.createTask('t1', '请愿 1');
      await store.createTask('t2', '请愿 2');
      await store.createTask('t3', '请愿 3');

      const res = await request(app)
        .get('/tasks?offset=1&limit=1')
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.offset).toBe(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].task_id).toBe('t2');
    });

    it('should truncate long petition text to 100 chars', async () => {
      const { app, store } = createTestApp();
      const longText = 'A'.repeat(200);
      await store.createTask('t-long', longText);

      const res = await request(app)
        .get('/tasks')
        .expect(200);

      expect(res.body.tasks[0].petition).toBe('A'.repeat(100) + '...');
    });

    it('should use default offset=0 and limit=20', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/tasks')
        .expect(200);

      expect(res.body.offset).toBe(0);
      expect(res.body.limit).toBe(20);
    });

    it('should cap limit at 100', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/tasks?limit=999')
        .expect(200);

      expect(res.body.limit).toBe(100);
    });

    it('should treat negative offset as 0', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/tasks?offset=-5')
        .expect(200);

      expect(res.body.offset).toBe(0);
    });
  });

  // ─── GET /task/:id/act ─────────────────────────────────────

  describe('GET /task/:id/act', () => {
    it('should return act data for existing task', async () => {
      const { app, store } = createTestApp();
      const actData = { title: '测试法案', steps: [{ description: '步骤一' }] };
      store.seedAct('act-task', actData);

      const res = await request(app)
        .get('/task/act-task/act')
        .expect(200);

      expect(res.body.task_id).toBe('act-task');
      expect(res.body.act).toEqual(actData);
      expect(res.body).toHaveProperty('created_at');
    });

    it('should return 404 when act not found', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/task/no-act/act')
        .expect(404);

      expect(res.body).toHaveProperty('detail', 'Act not found for this task');
    });

    it('should return 500 for corrupt act_json data', async () => {
      const { app, store } = createTestApp();
      // Manually seed corrupt JSON
      store['acts'].set('corrupt-act', { act_json: '{invalid json', created_at: new Date().toISOString() });

      const res = await request(app)
        .get('/task/corrupt-act/act')
        .expect(500);

      expect(res.body).toHaveProperty('detail', 'Corrupt act data');
    });

    it('should return 500 when act_json is a valid JSON array instead of an object', async () => {
      const { app, store } = createTestApp();
      store['acts'].set('array-act', { act_json: '["A", "B"]', created_at: new Date().toISOString() });

      const res = await request(app)
        .get('/task/array-act/act')
        .expect(500);

      expect(res.body).toHaveProperty('detail', 'Corrupt act data');
    });
  });

  // ─── GET /task/:id/debate ──────────────────────────────────

  describe('GET /task/:id/debate', () => {
    it('should return empty debate when no events', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/task/no-debate/debate')
        .expect(200);

      expect(res.body.task_id).toBe('no-debate');
      expect(res.body.rounds).toEqual([]);
      expect(res.body.conflict_score_curve).toEqual([]);
    });

    it('should reconstruct debate rounds from events', async () => {
      const { app, store } = createTestApp();
      store.seedEvents('debate-task', [
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '我们需要激进方案', conflict_score: 65.5, round_number: 1 }),
        },
        {
          action: 'propose',
          source_agent: 'conservative_mp',
          payload: JSON.stringify({ statement: '应该保守行事', conflict_score: 70.2, round_number: 1 }),
        },
        {
          action: 'brawl',  // non-propose events should be skipped
          source_agent: 'speaker',
          payload: JSON.stringify({}),
        },
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '第二轮激进', conflict_score: 45.0, round_number: 2 }),
        },
      ]);

      const res = await request(app)
        .get('/task/debate-task/debate')
        .expect(200);

      expect(res.body.task_id).toBe('debate-task');
      expect(res.body.rounds).toHaveLength(2);

      // Round 1
      expect(res.body.rounds[0].round_number).toBe(1);
      expect(res.body.rounds[0].radical_statement).toBe('我们需要激进方案');
      expect(res.body.rounds[0].conservative_statement).toBe('应该保守行事');
      expect(res.body.rounds[0].conflict_score).toBe(70.2);

      // Round 2
      expect(res.body.rounds[1].round_number).toBe(2);
      expect(res.body.rounds[1].radical_statement).toBe('第二轮激进');
      expect(res.body.rounds[1].conservative_statement).toBe('');

      // Conflict score curve
      expect(res.body.conflict_score_curve).toEqual([65.5, 70.2, 45.0]);
    });

    it('should skip events with round_number < 1', async () => {
      const { app, store } = createTestApp();
      store.seedEvents('bad-round', [
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '异常数据', conflict_score: 50, round_number: 0 }),
        },
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '正常数据', conflict_score: 30, round_number: 1 }),
        },
      ]);

      const res = await request(app)
        .get('/task/bad-round/debate')
        .expect(200);

      // round_number=0 event should be skipped
      expect(res.body.rounds).toHaveLength(1);
      expect(res.body.rounds[0].radical_statement).toBe('正常数据');
      expect(res.body.conflict_score_curve).toEqual([30]);
    });

    it('should skip events with corrupt payload JSON', async () => {
      const { app, store } = createTestApp();
      store.seedEvents('corrupt-payload', [
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: '{not valid json!!!',  // corrupt
        },
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '正常事件', conflict_score: 42, round_number: 1 }),
        },
      ]);

      const res = await request(app)
        .get('/task/corrupt-payload/debate')
        .expect(200);

      // corrupt event should be skipped, only the valid one remains
      expect(res.body.rounds).toHaveLength(1);
      expect(res.body.rounds[0].radical_statement).toBe('正常事件');
      expect(res.body.conflict_score_curve).toEqual([42]);
    });

    it('should drop excessively large round_number to prevent OOM DOS', async () => {
      const { app, store } = createTestApp();
      store.seedEvents('oom-payload', [
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '恶意事件', conflict_score: 99, round_number: 9999999999 }),
        },
      ]);

      const res = await request(app)
        .get('/task/oom-payload/debate')
        .expect(200);

      // Should be dropped entirely
      expect(res.body.rounds).toHaveLength(0);
      expect(res.body.conflict_score_curve).toEqual([]);
    });

    it('should correctly parse Speaker interventions and append them to the latest round', async () => {
      const { app, store } = createTestApp();
      store.seedEvents('speaker-intervene', [
        {
          action: 'propose',
          source_agent: 'radical_mp',
          payload: JSON.stringify({ statement: '第一轮激进', conflict_score: 20, round_number: 1 }),
        },
        {
          action: 'order', // Speaker intervention
          source_agent: 'speaker',
          // speaker's payload uses 'intensity' typically instead of 'conflict_score', we handle both
          payload: JSON.stringify({ statement: 'ORDER! 肃静！', intensity: 90.0 }),
        },
      ]);

      const res = await request(app)
        .get('/task/speaker-intervene/debate')
        .expect(200);

      expect(res.body.rounds).toHaveLength(1);
      expect(res.body.rounds[0].radical_statement).toBe('第一轮激进');
      expect(res.body.rounds[0].speaker_intervention).toBe('ORDER! 肃静！');
      expect(res.body.conflict_score_curve).toEqual([20, 90]);
    });
  });

  // ─── GET /task/:id/verdict ─────────────────────────────────

  describe('GET /task/:id/verdict', () => {
    it('should return verdict for existing task', async () => {
      const { app, store } = createTestApp();
      store.seedVerdict('verdict-task', {
        constitutional: 1,
        ruling: '法案合宪',
        evidence: JSON.stringify(['证据1', '证据2']),
      });

      const res = await request(app)
        .get('/task/verdict-task/verdict')
        .expect(200);

      expect(res.body.task_id).toBe('verdict-task');
      expect(res.body.constitutional).toBe(true);
      expect(res.body.ruling).toBe('法案合宪');
      expect(res.body.evidence).toEqual(['证据1', '证据2']);
      expect(res.body).toHaveProperty('created_at');
    });

    it('should return unconstitutional verdict correctly', async () => {
      const { app, store } = createTestApp();
      store.seedVerdict('unconst-task', {
        constitutional: 0,
        ruling: '法案违宪',
        evidence: JSON.stringify(['违反第一条']),
      });

      const res = await request(app)
        .get('/task/unconst-task/verdict')
        .expect(200);

      expect(res.body.constitutional).toBe(false);
    });

    it('should return 404 when verdict not found', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .get('/task/no-verdict/verdict')
        .expect(404);

      expect(res.body).toHaveProperty('detail', 'Verdict not found for this task');
    });

    it('should gracefully handle corrupt evidence JSON', async () => {
      const { app, store } = createTestApp();
      store['verdicts'].set('corrupt-v', {
        constitutional: 1,
        ruling: '判决',
        evidence: '{not valid json',
        created_at: new Date().toISOString(),
      });

      const res = await request(app)
        .get('/task/corrupt-v/verdict')
        .expect(200);

      expect(res.body.evidence).toEqual([]); // falls back to empty array
    });

    it('should fall back to empty array if evidence is a valid JSON string but not an array', async () => {
      const { app, store } = createTestApp();
      store['verdicts'].set('string-v', {
        constitutional: 1,
        ruling: '判决',
        evidence: '"this is just a string"', // valid json string, not array
        created_at: new Date().toISOString(),
      });

      const res = await request(app)
        .get('/task/string-v/verdict')
        .expect(200);

      expect(res.body.evidence).toEqual([]);
    });

    it('should map evidence items to strings if they are numbers', async () => {
      const { app, store } = createTestApp();
      store['verdicts'].set('array-v', {
        constitutional: 1,
        ruling: '判决',
        evidence: '[123, 456]', // valid json array of numbers
        created_at: new Date().toISOString(),
      });

      const res = await request(app)
        .get('/task/array-v/verdict')
        .expect(200);

      expect(res.body.evidence).toEqual(['123', '456']); // coerced to strings
    });
  });

  // ─── Error handling ─────────────────────────────────────

  describe('Error handling', () => {
    it('should return 500 when store throws during petition', async () => {
      const { app, store } = createTestApp();
      // Make createTask throw
      store.createTask = async () => { throw new Error('DB write failed'); };

      const res = await request(app)
        .post('/petition')
        .send({ prompt: '触发错误' })
        .expect(500);

      expect(res.body).toHaveProperty('error', 'Internal Server Error');
    });
  });
});
