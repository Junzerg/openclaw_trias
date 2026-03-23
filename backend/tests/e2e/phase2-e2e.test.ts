/**
 * Phase 2 · 端到端联调测试
 *
 * 在进程内启动真实 Express HTTP + WebSocket 服务器，
 * 使用 Mock CyberGovernment（发布完整事件序列到真实 MessageBus），
 * 配合真实 TaskStore(:memory: SQLite)、TaskQueue、ConnectionManager，
 * 验证从 POST /petition 到 WS 事件推送再到 REST 查询的全链路。
 *
 * 验收点（对应 task2.5_e2e_verification.md）：
 *  1. POST /petition → 202 + task_id
 *  2. WS 收到完整状态转换链
 *  3. WS ≥6 种事件类型
 *  4. GET /task/:id/status → completed
 *  5. GET /task/:id/act → 非空法案
 *  6. GET /task/:id/debate → ≥1 轮辩论
 *  7. GET /task/:id/verdict → 合宪判决
 *  8. SQLite 持久化完整性
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { MessageBus } from '../../src/bus/message-bus';
import { EventAction, EmotionType } from '../../src/schemas/events';
import { TaskStore } from '../../src/server/task-store';
import { TaskQueue } from '../../src/server/task-queue';
import { ConnectionManager } from '../../src/server/ws-manager';
import { handleWebSocketConnection } from '../../src/server/websocket';
import { createApp, TaskStatus, type AppState } from '../../src/server/app';
import {
  createWsBridge,
  createDbBridge,
} from '../../src/server/pipeline-bridge';

// ─── 辅助工具 ──────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(client: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.readyState === WebSocket.OPEN) { resolve(); return; }
    const timer = setTimeout(
      () => reject(new Error(`waitForOpen timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.once('open', () => { clearTimeout(timer); resolve(); });
    client.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** 收集至少 count 条消息，或超时后返回已收到的消息 */
function collectMessages(
  client: WebSocket,
  count: number,
  timeoutMs = 10000,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    const timer = setTimeout(() => {
      client.off('message', handler);
      // 超时但已有消息则返回已收集的（宽容模式）
      if (messages.length > 0) {
        resolve(messages);
      } else {
        reject(new Error(`collectMessages timed out waiting for ${count} messages, got 0`));
      }
    }, timeoutMs);
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

// ─── Mock CyberGovernment ─────────────────────────────────────

/**
 * 模拟完整 Pipeline 事件流的 Mock CyberGovernment。
 * 在 receivePetition 中依次发布 8 个核心事件到真实 MessageBus，
 * 覆盖 drafting → debating → propose → brawl → order → vote_passed
 *       → signed → sign_act → executing → reviewing → constitutional → delivered。
 */
function createMockGovernment() {
  const bus = new MessageBus();

  return {
    bus,
    inaugurate: async () => { await bus.start(); },
    shutdown: async () => { await bus.stop(); },

    receivePetition: async (
      prompt: string,
      _maxRetries?: number,
      taskId?: string,
    ) => {
      const tid = taskId ?? 'mock-task';

      // 1. state_change: drafting
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'drafting' },
        task_id: tid,
      });

      // 2. state_change: debating
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'debating' },
        task_id: tid,
      });

      // 3. propose
      await bus.publish('legislation', {
        timestamp: new Date(), source_agent: 'radical_mp',
        action: EventAction.PROPOSE,
        emotion: EmotionType.PASSIONATE, intensity: 0.8,
        payload: { statement: `关于"${prompt}"的立法提案`, round_number: 1 },
        task_id: tid,
      });

      // 4. brawl (高冲突)
      await bus.publish('legislation', {
        timestamp: new Date(), source_agent: 'conservative_mp',
        action: EventAction.BRAWL,
        emotion: EmotionType.ANGRY, intensity: 0.9,
        payload: { statement: '此提案过于激进！', round_number: 1, conflict_score: 75 },
        task_id: tid,
      });

      // 5. order (议长控场)
      await bus.publish('legislation', {
        timestamp: new Date(), source_agent: 'speaker',
        action: EventAction.ORDER,
        emotion: EmotionType.STERN, intensity: 0.7,
        payload: { statement: '请双方保持秩序！' },
        task_id: tid,
      });

      // 6. state_change: voted
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'voted' },
        task_id: tid,
      });

      // 7. vote_passed + act
      const actData = {
        act_id: tid,
        title: `关于"${prompt}"的法案`,
        summary: '经议会辩论通过的立法方案',
        sections: [
          { title: '第一条', content: '使用 CodeExecution 技能实现核心逻辑' },
        ],
      };
      await bus.publish('legislation', {
        timestamp: new Date(), source_agent: 'speaker',
        action: EventAction.VOTE_PASSED,
        emotion: EmotionType.TRIUMPHANT, intensity: 0.8,
        payload: { act: actData, ayes: 2, nays: 0, result: 'passed' },
        task_id: tid,
      });

      // 8. state_change: signed
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'signed' },
        task_id: tid,
      });

      // 9. sign_act
      await bus.publish('execution', {
        timestamp: new Date(), source_agent: 'president',
        action: EventAction.SIGN_ACT,
        emotion: EmotionType.CONFIDENT, intensity: 0.6,
        payload: { act_name: `关于"${prompt}"的法案` },
        task_id: tid,
      });

      // 10. state_change: executing
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'executing' },
        task_id: tid,
      });

      // 11. tool_call
      await bus.publish('execution', {
        timestamp: new Date(), source_agent: 'sec_engineering',
        action: EventAction.TOOL_CALL,
        emotion: EmotionType.NEUTRAL, intensity: 0.5,
        payload: { logs: 'Executing code...' },
        task_id: tid,
      });

      // 12. state_change: reviewing
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'reviewing' },
        task_id: tid,
      });

      // 13. constitutional (合宪判决)
      const verdictData = {
        constitutional: true,
        ruling: '法案内容与请愿完全一致，判定合宪',
        evidence: ['请愿内容匹配', '执行结果正确'],
      };
      await bus.publish('judiciary', {
        timestamp: new Date(), source_agent: 'chief_justice',
        action: EventAction.CONSTITUTIONAL,
        emotion: EmotionType.STERN, intensity: 0.5,
        payload: { verdict: verdictData },
        task_id: tid,
      });

      // 14. state_change: delivered
      await bus.publish('lifecycle', {
        timestamp: new Date(), source_agent: 'government',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL, intensity: 0,
        payload: { bill_id: tid, state: 'delivered' },
        task_id: tid,
      });

      return `法案 ${tid} 已交付。\n执行状态: completed\n判决: 合宪`;
    },
  };
}

// ─── Test Suite ────────────────────────────────────────────────

describe('Phase 2 端到端联调测试', () => {
  let taskStore: TaskStore;
  let wsManager: ConnectionManager;
  let government: ReturnType<typeof createMockGovernment>;
  let state: AppState;
  let server: Server;
  let port: number;

  // 启动真实 HTTP + WS 服务器
  beforeAll(async () => {
    taskStore = new TaskStore(':memory:');
    await taskStore.initialize();
    wsManager = new ConnectionManager();
    government = createMockGovernment();

    state = {
      government: government as unknown as AppState['government'],
      taskStore,
      taskQueue: new TaskQueue(1),
      wsManager,
    };

    // 注册双通道桥接（模拟 initLifecycle 的核心逻辑）
    const wsBridge = createWsBridge(wsManager);
    const dbBridge = createDbBridge(taskStore);
    const TOPICS = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
    for (const topic of TOPICS) {
      government.bus.subscribe(topic, wsBridge);
      government.bus.subscribe(topic, dbBridge);
    }
    await government.inaugurate();

    // 创建真实 Express 应用
    const app = createApp(state);

    // 创建 HTTP 服务器 + WS 升级
    server = createServer(app);
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    server.on('upgrade', (request, socket, head) => {
      socket.on('error', () => {}); // 静默处理
      const pathname = request.url?.split('?')[0] ?? '';
      const match = pathname.match(/^\/ws\/task\/(.+)$/);
      if (match) {
        let decodedTaskId: string;
        try {
          decodedTaskId = decodeURIComponent(match[1]);
        } catch {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          handleWebSocketConnection(ws, decodedTaskId, wsManager, state);
        });
      } else {
        socket.destroy();
      }
    });

    // 监听随机端口
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // 强制关闭所有 TCP 连接（包括 WS 和 HTTP keep-alive）
    server.closeAllConnections?.();
    server.close();
    await government.shutdown();
    await taskStore.close();
    // 给一点时间让资源释放
    await sleep(100);
  }, 10000);

  // ─── 完整链路测试 ─────────────────────────────────────────

  it('E2E-P2-01: POST /petition → 202 + task_id', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/petition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '帮我写一个 hello world 程序，要求使用 TypeScript 实现' }),
    });

    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.task_id).toBeDefined();
    expect(typeof body.task_id).toBe('string');
    expect(body.status).toBe('pending');
    expect(body.message).toBeDefined();
  });

  it('E2E-P2-02: 全链路 WS 事件流 → REST 查询 → SQLite 持久化', async () => {
    // 策略：使用已知 task_id，先建 DB 记录 + 连 WS，再触发 Pipeline，
    // 保证 WS 客户端在事件广播之前就已就绪。
    const taskId = 'e2e-ws-full-flow-test';
    await taskStore.createTask(taskId, '请实现一个 TODO 应用，包含增删改查功能');

    // ── Step 1: 先连 WS ──
    const wsClient = new WebSocket(`ws://127.0.0.1:${port}/ws/task/${taskId}`);
    await waitForOpen(wsClient);

    // 开始收集 WS 消息（Mock Pipeline 发布 14 个事件，全部收集）
    const msgPromise = collectMessages(wsClient, 14, 15000);

    // ── Step 2: 直接触发 Pipeline（绕过 TaskQueue 避免排队延迟）──
    await government.receivePetition(
      '请实现一个 TODO 应用，包含增删改查功能',
      undefined,
      taskId,
    );

    // 同步更新 task 状态（模拟 runPetition 的状态更新）
    await taskStore.updateTask(taskId, {
      status: TaskStatus.COMPLETED,
      result: `法案 ${taskId} 已交付。`,
    });

    // ── Step 3: 验证 WS 事件流 ──
    const messages = await msgPromise;
    const wsEvents = messages.map((m) => JSON.parse(m));

    // 3a. 检查收到的事件类型
    const actionSet = new Set(wsEvents.map((e: Record<string, unknown>) => e.action));
    expect(actionSet.has('state_change')).toBe(true);
    expect(actionSet.has('propose')).toBe(true);
    expect(actionSet.has('vote_passed')).toBe(true);
    expect(actionSet.has('sign_act')).toBe(true);
    expect(actionSet.has('constitutional')).toBe(true);

    // 3b. 至少 6 种不同事件类型
    expect(actionSet.size).toBeGreaterThanOrEqual(6);

    // 3c. state_change 事件应包含关键生命周期状态
    const stateChanges = wsEvents.filter((e: Record<string, unknown>) => e.action === 'state_change');
    const states = stateChanges.map((e: Record<string, unknown>) => e.state);
    expect(states).toContain('debating');
    expect(states).toContain('voted');
    expect(states).toContain('signed');
    expect(states).toContain('executing');
    expect(states).toContain('reviewing');
    expect(states).toContain('delivered');

    // 3d. 验证 propose 事件的 payload 展开到顶层
    const proposeEvent = wsEvents.find((e: Record<string, unknown>) => e.action === 'propose');
    expect(proposeEvent).toBeDefined();
    expect(proposeEvent.source_agent).toBe('radical_mp');
    expect(typeof proposeEvent.statement).toBe('string');
    expect(proposeEvent.round_number).toBe(1);
    expect(typeof proposeEvent.timestamp).toBe('string');

    // ── Step 4: 验证 GET /task/:id/status → completed ──
    const statusRes = await fetch(`http://127.0.0.1:${port}/task/${taskId}/status`);
    expect(statusRes.ok).toBe(true);
    const statusBody = await statusRes.json() as Record<string, unknown>;
    expect(statusBody.task_id).toBe(taskId);
    expect(statusBody.status).toBe('completed');

    // ── Step 5: 验证 GET /task/:id/act → 非空法案 ──
    const actRes = await fetch(`http://127.0.0.1:${port}/task/${taskId}/act`);
    expect(actRes.ok).toBe(true);
    const actBody = await actRes.json() as Record<string, unknown>;
    expect(actBody.task_id).toBe(taskId);
    expect(actBody.act).toBeDefined();
    const act = actBody.act as Record<string, unknown>;
    expect(act.title).toBeDefined();
    expect(typeof act.title).toBe('string');

    // ── Step 6: 验证 GET /task/:id/debate → ≥1 轮辩论记录 ──
    const debateRes = await fetch(`http://127.0.0.1:${port}/task/${taskId}/debate`);
    expect(debateRes.ok).toBe(true);
    const debateBody = await debateRes.json() as Record<string, unknown>;
    expect(debateBody.task_id).toBe(taskId);
    const rounds = debateBody.rounds as Array<unknown>;
    expect(Array.isArray(rounds)).toBe(true);
    expect(rounds.length).toBeGreaterThanOrEqual(1);

    // ── Step 7: 验证 GET /task/:id/verdict → 合宪判决 ──
    const verdictRes = await fetch(`http://127.0.0.1:${port}/task/${taskId}/verdict`);
    expect(verdictRes.ok).toBe(true);
    const verdictBody = await verdictRes.json() as Record<string, unknown>;
    expect(verdictBody.task_id).toBe(taskId);
    expect(verdictBody.constitutional).toBe(true);
    expect(typeof verdictBody.ruling).toBe('string');
    expect(Array.isArray(verdictBody.evidence)).toBe(true);

    // 关闭 WS 客户端
    wsClient.close();
    await sleep(100);
  }, 30000);

  // ─── GET /tasks 分页列表 ──────────────────────────────────

  it('E2E-P2-03: GET /tasks 返回分页历史任务列表', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tasks?offset=0&limit=10`);
    expect(res.ok).toBe(true);

    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.total).toBe('number');
    expect((body.total as number)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.tasks)).toBe(true);
    const tasks = body.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].task_id).toBeDefined();
    expect(tasks[0].status).toBeDefined();
  });

  // ─── SQLite 持久化完整性 ──────────────────────────────────

  it('E2E-P2-04: SQLite 持久化 — events/acts/verdicts 表数据完整', async () => {
    // 提交一个新请愿用于验证 DB
    const petitionRes = await fetch(`http://127.0.0.1:${port}/petition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '请帮我实现一个计算器应用，支持加减乘除四则运算' }),
    });
    const { task_id: taskId } = (await petitionRes.json()) as { task_id: string };

    // 等待任务完成
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const task = await taskStore.getTask(taskId);
      if (task && (task.status === 'completed' || task.status === 'failed')) break;
    }

    // 验证 tasks 表
    const task = await taskStore.getTask(taskId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('completed');

    // 验证 events 表 — 应有 14 个事件
    const events = await taskStore.getTaskEvents(taskId);
    expect(events.length).toBeGreaterThanOrEqual(10);

    const eventActions = events.map((e) => e.action);
    expect(eventActions).toContain('state_change');
    expect(eventActions).toContain('propose');
    expect(eventActions).toContain('brawl');
    expect(eventActions).toContain('order');
    expect(eventActions).toContain('vote_passed');
    expect(eventActions).toContain('sign_act');
    expect(eventActions).toContain('tool_call');
    expect(eventActions).toContain('constitutional');

    // 验证 acts 表
    const actRow = await taskStore.getTaskAct(taskId);
    expect(actRow).not.toBeNull();
    const act = JSON.parse(actRow!.act_json);
    expect(act.title).toBeDefined();

    // 验证 verdicts 表
    const verdictRow = await taskStore.getTaskVerdict(taskId);
    expect(verdictRow).not.toBeNull();
    expect(verdictRow!.constitutional).toBe(1); // SQLite boolean = 1
    expect(verdictRow!.ruling).toContain('合宪');
  });

  // ─── WS 连接管理验证 ──────────────────────────────────────

  it('E2E-P2-05: WS 连接到不存在的 task → 仍能连接（只是不收到事件）', async () => {
    const wsClient = new WebSocket(`ws://127.0.0.1:${port}/ws/task/nonexistent-task`);
    await waitForOpen(wsClient);
    expect(wsClient.readyState).toBe(WebSocket.OPEN);

    // 发送 ping 应收到 pong
    wsClient.send('ping');
    const pongMsg = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pong timeout')), 3000);
      wsClient.once('message', (data) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
    });
    const pong = JSON.parse(pongMsg);
    expect(pong.type).toBe('pong');

    wsClient.close();
    await sleep(50);
  });

  // ─── 非法路径的 WS 升级应被拒绝 ────────────────────────

  it('E2E-P2-06: 非法 WS 路径不能升级', async () => {
    const wsClient = new WebSocket(`ws://127.0.0.1:${port}/ws/invalid`);

    const closed = await new Promise<boolean>((resolve) => {
      wsClient.on('error', () => resolve(true));
      wsClient.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });

    expect(closed).toBe(true);
  });

  // ─── POST /petition 参数校验 ──────────────────────────────

  it('E2E-P2-07: POST /petition 空 prompt → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/petition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('E2E-P2-08: POST /petition 缺少 prompt → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/petition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('E2E-P2-09: POST /petition 只含空格(trim后为空) → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/petition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
