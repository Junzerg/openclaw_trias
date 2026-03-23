/**
 * Pipeline 事件流集成测试 — 模拟完整 Pipeline 验证 WS + DB 双通道。
 *
 * 使用 Mock CyberGovernment（在 receivePetition 中发布事件到真实 MessageBus），
 * 配合真实 TaskStore（:memory: SQLite）和真实 ConnectionManager + WS Server，
 * 验证事件从 bus 流转到 WS 客户端和 DB 的完整链路。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { MessageBus } from '../../src/bus/message-bus';
import { EventAction, EmotionType, type BaseEvent } from '../../src/schemas/events';
import { TaskStore } from '../../src/server/task-store';
import { TaskQueue } from '../../src/server/task-queue';
import { ConnectionManager } from '../../src/server/ws-manager';
import { handleWebSocketConnection } from '../../src/server/websocket';
import { TaskStatus, type AppState } from '../../src/server/app';
import {
  createWsBridge,
  createDbBridge,
  runPetition,
  serializeEvent,
} from '../../src/server/pipeline-bridge';

// ─── 辅助工具 ──────────────────────────────────────────────────

function waitForMessage(client: WebSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

function waitForOpen(client: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`waitForOpen timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 收集多条消息 */
function collectMessages(client: WebSocket, count: number, timeoutMs = 5000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const timer = setTimeout(
      () => reject(new Error(`collectMessages timed out waiting for ${count} messages, got ${messages.length}`)),
      timeoutMs,
    );
    const handler = (data: Buffer | string) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        clearTimeout(timer);
        client.off('message', handler);
        resolve(messages);
      }
    };
    client.on('message', handler);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Mock CyberGovernment ─────────────────────────────────────

/**
 * 创建 Mock CyberGovernment，在 receivePetition 中向 bus 发布一系列事件。
 * 模拟从 drafting → debating → vote_passed → signed → executing → constitutional 的完整流程。
 */
function createMockGovernment() {
  const bus = new MessageBus();

  return {
    bus,
    inaugurate: async () => { await bus.start(); },
    shutdown: async () => { await bus.stop(); },
    receivePetition: async (prompt: string, _maxRetries?: number, taskId?: string) => {
      // 1. state_change: drafting
      await bus.publish('lifecycle', {
        timestamp: new Date(),
        source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL,
        intensity: 0,
        payload: { bill_id: taskId, state: 'drafting' },
        task_id: taskId,
      });

      // 2. propose event
      await bus.publish('legislation', {
        timestamp: new Date(),
        source_agent: 'radical_mp',
        action: EventAction.PROPOSE,
        emotion: EmotionType.PASSIONATE,
        intensity: 0.8,
        payload: { statement: 'We need bold action!', round_number: 1 },
        task_id: taskId,
      });

      // 3. brawl event
      await bus.publish('legislation', {
        timestamp: new Date(),
        source_agent: 'conservative_mp',
        action: EventAction.BRAWL,
        emotion: EmotionType.ANGRY,
        intensity: 0.9,
        payload: { statement: 'Too extreme!', round_number: 1, conflict_score: 75 },
        task_id: taskId,
      });

      // 4. vote_passed with act
      const actData = {
        act_id: taskId,
        title: 'Test Act',
        sections: [{ title: 'Section 1', content: 'Content' }],
      };
      await bus.publish('legislation', {
        timestamp: new Date(),
        source_agent: 'speaker',
        action: EventAction.VOTE_PASSED,
        emotion: EmotionType.TRIUMPHANT,
        intensity: 0.8,
        payload: { act: actData, ayes: 2, nays: 0, result: 'passed' },
        task_id: taskId,
      });

      // 5. sign_act
      await bus.publish('execution', {
        timestamp: new Date(),
        source_agent: 'president',
        action: EventAction.SIGN_ACT,
        emotion: EmotionType.CONFIDENT,
        intensity: 0.6,
        payload: { act_name: 'Test Act' },
        task_id: taskId,
      });

      // 6. constitutional verdict
      const verdictData = {
        constitutional: true,
        ruling: 'Approved by court',
        evidence: ['Evidence 1'],
      };
      await bus.publish('judiciary', {
        timestamp: new Date(),
        source_agent: 'chief_justice',
        action: EventAction.CONSTITUTIONAL,
        emotion: EmotionType.STERN,
        intensity: 0.5,
        payload: { verdict: verdictData },
        task_id: taskId,
      });

      return `法案 ${taskId} 已交付。`;
    },
  } as any;
}

// ─── WS 测试服务器 ────────────────────────────────────────────

function createTestWsServer(
  wsManager: ConnectionManager,
  appState: AppState,
): { port: number; close: () => Promise<void> } {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] ?? '';
    const match = pathname.match(/^\/ws\/task\/(.+)$/);
    if (match) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleWebSocketConnection(ws, match[1], wsManager, appState);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const close = () =>
    new Promise<void>((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });

  return { port, close };
}

// ─── 集成测试 ──────────────────────────────────────────────────

describe('Pipeline Integration', () => {
  let taskStore: TaskStore;
  let wsManager: ConnectionManager;
  let government: ReturnType<typeof createMockGovernment>;
  let state: AppState;

  beforeEach(async () => {
    taskStore = new TaskStore(':memory:');
    await taskStore.initialize();
    wsManager = new ConnectionManager();
    government = createMockGovernment();

    state = {
      government,
      taskStore,
      taskQueue: new TaskQueue(1),
      wsManager,
    };
  });

  afterEach(async () => {
    await taskStore.close();
  });

  // ─── DB Bridge 集成 ─────────────────────────────────────────

  describe('DB Bridge full pipeline', () => {
    it('should persist all events to events table through bus', async () => {
      // 注册 DB 桥接
      const dbBridge = createDbBridge(taskStore);
      const topics = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
      for (const topic of topics) {
        government.bus.subscribe(topic, dbBridge);
      }

      // 创建任务并执行 Pipeline
      const taskId = 'int-test-001';
      await taskStore.createTask(taskId, 'Test petition');
      await government.receivePetition('Test petition', undefined, taskId);

      // 验证 events 表
      const events = await taskStore.getTaskEvents(taskId);
      expect(events.length).toBe(6); // drafting + propose + brawl + vote_passed + sign_act + constitutional

      // 验证 event actions
      const actions = events.map((e) => e.action);
      expect(actions).toContain('state_change');
      expect(actions).toContain('propose');
      expect(actions).toContain('brawl');
      expect(actions).toContain('vote_passed');
      expect(actions).toContain('sign_act');
      expect(actions).toContain('constitutional');
    });

    it('should auto-persist act to acts table on vote_passed', async () => {
      const dbBridge = createDbBridge(taskStore);
      government.bus.subscribe('legislation', dbBridge);

      const taskId = 'int-test-002';
      await taskStore.createTask(taskId, 'Test petition');
      await government.receivePetition('Test petition', undefined, taskId);

      // 验证 acts 表
      const actRow = await taskStore.getTaskAct(taskId);
      expect(actRow).not.toBeNull();
      const act = JSON.parse(actRow!.act_json);
      expect(act.title).toBe('Test Act');
      expect(act.sections).toHaveLength(1);
    });

    it('should auto-persist verdict to verdicts table on constitutional', async () => {
      const dbBridge = createDbBridge(taskStore);
      government.bus.subscribe('judiciary', dbBridge);

      const taskId = 'int-test-003';
      await taskStore.createTask(taskId, 'Test petition');
      await government.receivePetition('Test petition', undefined, taskId);

      // 验证 verdicts 表
      const verdictRow = await taskStore.getTaskVerdict(taskId);
      expect(verdictRow).not.toBeNull();
      expect(verdictRow!.constitutional).toBe(1); // SQLite boolean = 1
      expect(verdictRow!.ruling).toBe('Approved by court');
      expect(JSON.parse(verdictRow!.evidence)).toEqual(['Evidence 1']);
    });
  });

  // ─── WS Bridge 集成 ─────────────────────────────────────────

  describe('WS Bridge full pipeline', () => {
    let testServer: ReturnType<typeof createTestWsServer>;

    beforeEach(() => {
      testServer = createTestWsServer(wsManager, state);
    });

    afterEach(async () => {
      await testServer.close();
    });

    it('should broadcast serialized events to WS clients', async () => {
      // 注册 WS 桥接
      const wsBridge = createWsBridge(wsManager);
      const topics = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
      for (const topic of topics) {
        government.bus.subscribe(topic, wsBridge);
      }

      const taskId = 'ws-test-001';
      await taskStore.createTask(taskId, 'WS test petition');

      // 连接 WS 客户端
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/${taskId}`);
      await waitForOpen(client);

      // 收集 6 条消息（对应 6 个事件）
      const msgPromise = collectMessages(client, 6);

      // 执行 Pipeline
      await government.receivePetition('WS test petition', undefined, taskId);

      const messages = await msgPromise;
      expect(messages.length).toBe(6);

      // 解析并验证格式
      const parsed = messages.map((m) => JSON.parse(m));

      // 验证第一条 state_change
      expect(parsed[0].action).toBe('state_change');
      expect(parsed[0].source_agent).toBe('government');
      expect(parsed[0].task_id).toBe(taskId);
      expect(typeof parsed[0].timestamp).toBe('string');

      // 验证 propose 事件的 payload 展开
      const proposeEvent = parsed.find((e: any) => e.action === 'propose');
      expect(proposeEvent).toBeDefined();
      expect(proposeEvent.source_agent).toBe('radical_mp');
      expect(proposeEvent.statement).toBe('We need bold action!'); // payload 展开
      expect(proposeEvent.round_number).toBe(1); // payload 展开

      // 验证 vote_passed 事件
      const voteEvent = parsed.find((e: any) => e.action === 'vote_passed');
      expect(voteEvent).toBeDefined();
      expect(voteEvent.act).toBeDefined();
      expect(voteEvent.act.title).toBe('Test Act');

      client.close();
      await sleep(50);
    });
  });

  // ─── runPetition 状态管理 ────────────────────────────────────

  describe('runPetition state lifecycle', () => {
    it('should transition task through PENDING → RUNNING → COMPLETED', async () => {
      const taskId = 'run-test-001';
      await taskStore.createTask(taskId, 'Test petition');

      // 验证初始状态
      let task = await taskStore.getTask(taskId);
      expect(task!.status).toBe(TaskStatus.PENDING);

      // 执行 pipeline
      await runPetition(taskId, 'Test petition', state);

      // 验证最终状态
      task = await taskStore.getTask(taskId);
      expect(task!.status).toBe(TaskStatus.COMPLETED);
      expect(task!.result).toContain('已交付');
    });

    it('should set FAILED status when pipeline throws', async () => {
      // Override receivePetition to throw
      state.government.receivePetition = async () => {
        throw new Error('LLM API error');
      };

      const taskId = 'run-test-002';
      await taskStore.createTask(taskId, 'Failing petition');

      await runPetition(taskId, 'Failing petition', state);

      const task = await taskStore.getTask(taskId);
      expect(task!.status).toBe(TaskStatus.FAILED);
      expect(task!.result).toBe('LLM API error');
    });
  });

  // ─── 完整双通道集成 ──────────────────────────────────────────

  describe('Full dual-channel integration', () => {
    let testServer: ReturnType<typeof createTestWsServer>;

    beforeEach(() => {
      testServer = createTestWsServer(wsManager, state);
    });

    afterEach(async () => {
      await testServer.close();
    });

    it('should persist events AND broadcast to WS simultaneously', async () => {
      // 注册双通道桥接
      const wsBridge = createWsBridge(wsManager);
      const dbBridge = createDbBridge(taskStore);
      const topics = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
      for (const topic of topics) {
        government.bus.subscribe(topic, wsBridge);
        government.bus.subscribe(topic, dbBridge);
      }

      const taskId = 'dual-test-001';
      await taskStore.createTask(taskId, 'Dual channel test');

      // 连接 WS 客户端
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/${taskId}`);
      await waitForOpen(client);

      // 收集 WS 消息
      const msgPromise = collectMessages(client, 6);

      // 执行 Pipeline
      await government.receivePetition('Dual channel test', undefined, taskId);

      // 验证 WS 收到所有事件
      const messages = await msgPromise;
      expect(messages.length).toBe(6);

      // 验证 DB 也存了所有事件
      const events = await taskStore.getTaskEvents(taskId);
      expect(events.length).toBe(6);

      // 验证 acts + verdicts
      const act = await taskStore.getTaskAct(taskId);
      expect(act).not.toBeNull();

      const verdict = await taskStore.getTaskVerdict(taskId);
      expect(verdict).not.toBeNull();

      client.close();
      await sleep(50);
    });
  });
});
