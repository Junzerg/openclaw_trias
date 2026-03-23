/**
 * Pipeline 桥接模块单元测试 — 验证 serializeEvent、wsBridge、dbBridge、runPetition。
 *
 * 使用纯 Mock 对象测试，不依赖真实 WS Server 或 SQLite。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  serializeEvent,
  createWsBridge,
  createDbBridge,
  runPetition,
  initLifecycle,
} from '../../src/server/pipeline-bridge';
import { EventAction, EmotionType, type BaseEvent } from '../../src/schemas/events';
import { TaskStatus, type AppState, type ITaskStore, type IConnectionManager, type ITaskQueue } from '../../src/server/app';
import { MessageBus } from '../../src/bus/message-bus';

// ─── 测试辅助 ──────────────────────────────────────────────────

function makeEvent(overrides: Partial<BaseEvent> = {}): BaseEvent {
  return {
    timestamp: new Date('2025-06-15T10:30:00Z'),
    source_agent: 'speaker',
    action: EventAction.PROPOSE,
    emotion: EmotionType.PASSIONATE,
    intensity: 0.7,
    payload: { statement: 'Test proposal' },
    task_id: 'task-001',
    ...overrides,
  };
}

function createMockTaskStore(): ITaskStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(null),
    updateTask: vi.fn().mockResolvedValue(undefined),
    countTasks: vi.fn().mockResolvedValue(0),
    listTasks: vi.fn().mockResolvedValue([]),
    getTaskAct: vi.fn().mockResolvedValue(null),
    getTaskEvents: vi.fn().mockResolvedValue([]),
    getTaskVerdict: vi.fn().mockResolvedValue(null),
    storeEvent: vi.fn().mockResolvedValue(undefined),
    storeAct: vi.fn().mockResolvedValue(undefined),
    storeVerdict: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWsManager(): IConnectionManager {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    broadcast: vi.fn().mockResolvedValue(undefined),
    getConnectionCount: vi.fn().mockReturnValue(0),
  };
}

function createMockGovernment() {
  return {
    bus: new MessageBus(),
    inaugurate: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    receivePetition: vi.fn().mockResolvedValue('法案已通过'),
  } as any;
}

function createMockAppState(): AppState {
  return {
    government: createMockGovernment(),
    taskStore: createMockTaskStore(),
    taskQueue: { submit: vi.fn().mockResolvedValue(undefined) } as ITaskQueue,
    wsManager: createMockWsManager(),
  };
}

// ─── serializeEvent ────────────────────────────────────────────

describe('serializeEvent', () => {
  it('should serialize a normal BaseEvent with correct fields', () => {
    const event = makeEvent();
    const result = serializeEvent(event);

    expect(result.action).toBe('propose');
    expect(result.source_agent).toBe('speaker');
    expect(result.emotion).toBe('passionate');
    expect(result.intensity).toBe(0.7);
    expect(result.timestamp).toBe('2025-06-15T10:30:00.000Z');
    expect(result.task_id).toBe('task-001');
  });

  it('should expand payload fields to top-level', () => {
    const event = makeEvent({
      payload: { statement: 'Hello', round_number: 3, conflict_score: 42.5 },
    });
    const result = serializeEvent(event);

    expect(result.statement).toBe('Hello');
    expect(result.round_number).toBe(3);
    expect(result.conflict_score).toBe(42.5);
  });

  it('should NOT let payload fields override base fields', () => {
    const event = makeEvent({
      payload: { action: 'HACKED', source_agent: 'attacker', task_id: 'evil-id' },
    });
    const result = serializeEvent(event);

    // 基础字段不被覆盖
    expect(result.action).toBe('propose');
    expect(result.source_agent).toBe('speaker');
    expect(result.task_id).toBe('task-001');
  });

  it('should handle string timestamp gracefully', () => {
    const event = makeEvent({ timestamp: '2025-01-01T00:00:00Z' as any });
    const result = serializeEvent(event);

    expect(result.timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('should provide defaults for missing fields', () => {
    const event = makeEvent({
      timestamp: undefined as any,
      source_agent: undefined as any,
      action: undefined as any,
      emotion: undefined as any,
      intensity: undefined as any,
    });
    const result = serializeEvent(event);

    expect(result.action).toBe('unknown');
    expect(result.source_agent).toBe('unknown');
    expect(result.emotion).toBe('neutral');
    expect(result.intensity).toBe(0.5);
    expect(typeof result.timestamp).toBe('string');
  });

  it('should defend against null/undefined event object', () => {
    const result = serializeEvent(null as any);
    expect(result.action).toBe('unknown');
    expect(typeof result.timestamp).toBe('string');
  });

  it('should include target_agent when present', () => {
    const event = makeEvent({ target_agent: 'radical_mp' });
    const result = serializeEvent(event);

    expect(result.target_agent).toBe('radical_mp');
  });

  it('should omit target_agent when absent', () => {
    const event = makeEvent({ target_agent: undefined });
    const result = serializeEvent(event);

    expect(result.target_agent).toBeUndefined();
  });

  it('should handle empty payload', () => {
    const event = makeEvent({ payload: {} });
    const result = serializeEvent(event);

    // 基础字段仍然存在
    expect(result.action).toBe('propose');
    expect(result.source_agent).toBe('speaker');
  });

  it('should handle undefined payload', () => {
    const event = makeEvent({ payload: undefined as any });
    const result = serializeEvent(event);

    expect(result.action).toBe('propose');
  });
});

// ─── createWsBridge ────────────────────────────────────────────

describe('createWsBridge', () => {
  let wsManager: IConnectionManager;
  let bridge: ReturnType<typeof createWsBridge>;

  beforeEach(() => {
    wsManager = createMockWsManager();
    bridge = createWsBridge(wsManager);
  });

  it('should broadcast serialized event to wsManager', async () => {
    const event = makeEvent();
    await bridge(event);

    expect(wsManager.broadcast).toHaveBeenCalledTimes(1);
    const [taskId, payload] = (wsManager.broadcast as any).mock.calls[0];
    expect(taskId).toBe('task-001');
    expect(payload.action).toBe('propose');
    expect(payload.source_agent).toBe('speaker');
    expect(payload.timestamp).toBe('2025-06-15T10:30:00.000Z');
  });

  it('should skip events without task_id', async () => {
    const event = makeEvent({ task_id: undefined });
    await bridge(event);

    expect(wsManager.broadcast).not.toHaveBeenCalled();
  });

  it('should not throw when broadcast fails', async () => {
    (wsManager.broadcast as any).mockRejectedValue(new Error('WS down'));

    const event = makeEvent();
    // 不应该抛出异常
    await expect(bridge(event)).resolves.toBeUndefined();
  });
});

// ─── createDbBridge ────────────────────────────────────────────

describe('createDbBridge', () => {
  let taskStore: ITaskStore;
  let bridge: ReturnType<typeof createDbBridge>;

  beforeEach(() => {
    taskStore = createMockTaskStore();
    bridge = createDbBridge(taskStore);
  });

  it('should store event to events table', async () => {
    const event = makeEvent();
    await bridge(event);

    expect(taskStore.storeEvent).toHaveBeenCalledTimes(1);
    const args = (taskStore.storeEvent as any).mock.calls[0];
    expect(args[0]).toBe('task-001');       // taskId
    expect(args[1]).toBe('speaker');        // sourceAgent
    expect(args[2]).toBe('propose');        // action
    expect(args[3]).toBe('passionate');     // emotion
    expect(args[4]).toBe(0.7);             // intensity
    expect(JSON.parse(args[5])).toEqual({ statement: 'Test proposal' }); // payload
  });

  it('should skip events without task_id', async () => {
    const event = makeEvent({ task_id: undefined });
    await bridge(event);

    expect(taskStore.storeEvent).not.toHaveBeenCalled();
  });

  it('should auto-store act on vote_passed event', async () => {
    const actData = { title: 'Test Act', sections: [] };
    const event = makeEvent({
      action: EventAction.VOTE_PASSED,
      payload: { act: actData },
    });

    await bridge(event);

    expect(taskStore.storeAct).toHaveBeenCalledTimes(1);
    const [taskId, actJson] = (taskStore.storeAct as any).mock.calls[0];
    expect(taskId).toBe('task-001');
    expect(JSON.parse(actJson)).toEqual(actData);
  });

  it('should NOT store act on vote_passed without act in payload', async () => {
    const event = makeEvent({
      action: EventAction.VOTE_PASSED,
      payload: { result: 'passed' },
    });

    await bridge(event);

    expect(taskStore.storeAct).not.toHaveBeenCalled();
  });

  it('should auto-store verdict on constitutional event', async () => {
    const verdictData = { constitutional: true, ruling: 'Approved', evidence: ['ev1'] };
    const event = makeEvent({
      action: EventAction.CONSTITUTIONAL,
      payload: { verdict: verdictData },
    });

    await bridge(event);

    expect(taskStore.storeVerdict).toHaveBeenCalledTimes(1);
    const args = (taskStore.storeVerdict as any).mock.calls[0];
    expect(args[0]).toBe('task-001');          // taskId
    expect(args[1]).toBe(true);               // constitutional
    expect(args[2]).toBe('Approved');          // ruling
    expect(JSON.parse(args[3])).toEqual(['ev1']); // evidence
  });

  it('should auto-store verdict on unconstitutional event', async () => {
    const verdictData = { constitutional: false, ruling: 'Rejected', evidence: [] };
    const event = makeEvent({
      action: EventAction.UNCONSTITUTIONAL,
      payload: { verdict: verdictData },
    });

    await bridge(event);

    expect(taskStore.storeVerdict).toHaveBeenCalledTimes(1);
    const args = (taskStore.storeVerdict as any).mock.calls[0];
    expect(args[1]).toBe(false);
  });

  it('should NOT store verdict without verdict in payload', async () => {
    const event = makeEvent({
      action: EventAction.CONSTITUTIONAL,
      payload: { ruling: 'something' }, // verdict key is missing
    });

    await bridge(event);

    expect(taskStore.storeVerdict).not.toHaveBeenCalled();
  });

  it('should isolate storeEvent failure — does not crash', async () => {
    (taskStore.storeEvent as any).mockRejectedValue(new Error('DB locked'));

    const event = makeEvent();
    await expect(bridge(event)).resolves.toBeUndefined();
  });

  it('should isolate storeAct failure — storeEvent still succeeds', async () => {
    (taskStore.storeAct as any).mockRejectedValue(new Error('UNIQUE constraint'));

    const event = makeEvent({
      action: EventAction.VOTE_PASSED,
      payload: { act: { title: 'X' } },
    });

    // 整体不应该抛出
    await expect(bridge(event)).resolves.toBeUndefined();
    // storeEvent 仍然被调用（它在 storeAct 之前执行并成功）
    expect(taskStore.storeEvent).toHaveBeenCalledTimes(1);
  });
});

// ─── runPetition ───────────────────────────────────────────────

describe('runPetition', () => {
  let state: AppState;

  beforeEach(() => {
    state = createMockAppState();
  });

  it('should transition status: PENDING → RUNNING → COMPLETED', async () => {
    await runPetition('task-001', 'Build a TODO app', state);

    const calls = (state.taskStore.updateTask as any).mock.calls;
    expect(calls.length).toBe(2);

    // 第一次：RUNNING
    expect(calls[0][0]).toBe('task-001');
    expect(calls[0][1].status).toBe(TaskStatus.RUNNING);

    // 第二次：COMPLETED
    expect(calls[1][0]).toBe('task-001');
    expect(calls[1][1].status).toBe(TaskStatus.COMPLETED);
    expect(calls[1][1].result).toBe('法案已通过');
  });

  it('should call government.receivePetition with correct args', async () => {
    await runPetition('task-001', 'Build a TODO app', state);

    expect(state.government.receivePetition).toHaveBeenCalledWith(
      'Build a TODO app',
      undefined,
      'task-001',
    );
  });

  it('should set status to FAILED when receivePetition throws', async () => {
    (state.government.receivePetition as any).mockRejectedValue(new Error('LLM timeout'));

    await runPetition('task-001', 'prompt', state);

    const calls = (state.taskStore.updateTask as any).mock.calls;
    expect(calls.length).toBe(2);

    // 第一次：RUNNING
    expect(calls[0][1].status).toBe(TaskStatus.RUNNING);

    // 第二次：FAILED
    expect(calls[1][1].status).toBe(TaskStatus.FAILED);
    expect(calls[1][1].result).toBe('LLM timeout');
  });

  it('should not throw even when updateTask to FAILED also fails', async () => {
    (state.government.receivePetition as any).mockRejectedValue(new Error('Boom'));
    // 第二次 updateTask (设置 FAILED) 也会失败
    let callCount = 0;
    (state.taskStore.updateTask as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('DB disk full');
      }
    });

    // 不应该抛出
    await expect(runPetition('task-001', 'p', state)).resolves.toBeUndefined();
  });

  it('should store pipeline result in task record', async () => {
    (state.government.receivePetition as any).mockResolvedValue('Custom result string');

    await runPetition('task-001', 'prompt', state);

    const calls = (state.taskStore.updateTask as any).mock.calls;
    expect(calls[1][1].result).toBe('Custom result string');
  });
});

// ─── initLifecycle ─────────────────────────────────────────────

describe('initLifecycle', () => {
  it('should inaugurate government and initialize taskStore', async () => {
    const state = createMockAppState();

    const shutdown = await initLifecycle(state);

    expect(state.government.inaugurate).toHaveBeenCalledTimes(1);
    expect(state.taskStore.initialize).toHaveBeenCalledTimes(1);

    // 4 topics × 2 bridges = 8 subscriptions
    const bus = state.government.bus as MessageBus;
    for (const topic of ['legislation', 'execution', 'judiciary', 'lifecycle'] as const) {
      expect(bus.get_subscriber_count(topic)).toBe(2);
    }

    // Cleanup
    await shutdown();
  });

  it('should return a shutdown function that closes resources', async () => {
    const state = createMockAppState();

    const shutdown = await initLifecycle(state);
    await shutdown();

    expect(state.government.shutdown).toHaveBeenCalledTimes(1);
    expect(state.taskStore.close).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe bridges during shutdown', async () => {
    const state = createMockAppState();

    const shutdown = await initLifecycle(state);

    // 验证订阅已注册
    const bus = state.government.bus as MessageBus;
    expect(bus.get_subscriber_count('legislation')).toBe(2);

    await shutdown();

    // shutdown 后订阅应该被移除
    expect(bus.get_subscriber_count('legislation')).toBe(0);
  });
});
