/**
 * Pipeline 桥接模块 — 连接 CyberGovernment 消息总线与 WS/DB 通道。
 *
 * 翻译自 Python server/app.py 中的 lifespan() 内部桥接逻辑。
 *
 * 4 个核心函数：
 *   serializeEvent  — BaseEvent → 前端兼容 JSON（展开 payload 到顶层）
 *   createWsBridge  — 工厂函数，返回 bus Handler，广播事件到 WS 客户端
 *   createDbBridge  — 工厂函数，返回 bus Handler，持久化事件到 SQLite
 *   runPetition     — 后台任务执行器，调用 government.receivePetition 并维护状态
 */

import type { BaseEvent } from '../schemas/events';
import { EventAction } from '../schemas/events';
import type { Handler } from '../bus/message-bus';
import type { AppState, IConnectionManager, ITaskStore } from './app';
import { TaskStatus } from './app';

// ─── Event Serialization ───────────────────────────────────────

/**
 * 将 BaseEvent 序列化为前端兼容的 JSON 对象。
 *
 * 关键行为（对齐 Python 版 BaseEvent.model_dump(mode="json")）：
 * - Enum 转为 string 值
 * - Date/timestamp 转为 ISO 8601 字符串
 * - payload 字段展开到顶层（扁平化）
 *
 * 防御：对缺失字段、非标准类型提供安全默认值。
 */
export function serializeEvent(event: BaseEvent): Record<string, unknown> {
  // 防御性检查：确保 event 是对象
  if (!event || typeof event !== 'object') {
    return { action: 'unknown', source_agent: 'unknown', timestamp: new Date().toISOString() };
  }

  // timestamp 转换 — 兼容 Date 对象和 string
  let timestamp: string;
  if (event.timestamp instanceof Date) {
    timestamp = event.timestamp.toISOString();
  } else if (typeof event.timestamp === 'string') {
    timestamp = event.timestamp;
  } else {
    timestamp = new Date().toISOString();
  }

  // 基础字段（enum → string 已经由 TS 原生字符串枚举保证）
  const base: Record<string, unknown> = {
    action: event.action ?? 'unknown',
    source_agent: event.source_agent ?? 'unknown',
    emotion: event.emotion ?? 'neutral',
    intensity: typeof event.intensity === 'number' ? event.intensity : 0.5,
    timestamp,
    task_id: event.task_id ?? undefined,
  };

  // target_agent 仅在有值时包含
  if (event.target_agent) {
    base.target_agent = event.target_agent;
  }

  // 展开 payload 到顶层（Python model_dump 行为）
  // payload 字段优先级低于基础字段（不得覆盖 action/source_agent 等）
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    for (const [key, value] of Object.entries(event.payload)) {
      if (!(key in base)) {
        base[key] = value;
      }
    }
  }

  return base;
}

// ─── WS Bridge ────────────────────────────────────────────────

/**
 * 创建 WS 桥接处理器 — 将总线事件序列化后广播给 WS 客户端。
 *
 * 内部 try-catch 保证单次广播失败不影响其他桥接和核心 Pipeline。
 */
export function createWsBridge(wsManager: IConnectionManager): Handler {
  return async function _wsBridge(event: BaseEvent): Promise<void> {
    if (!event.task_id) return;

    // 添加实时打印，方便在终端查看执行过程
    console.log(`[Bus Event] ${event.action.toUpperCase()} from ${event.source_agent}`);
    if (event.payload && typeof event.payload === 'object' && 'statement' in event.payload) {
      console.log(`💬  ${event.payload.statement}`);
    }

    try {
      const wsPayload = serializeEvent(event);
      await wsManager.broadcast(event.task_id, wsPayload);
    } catch (err) {
      console.error('[WS Bridge] Failed to broadcast event:', err);
    }
  };
}

// ─── DB Bridge ────────────────────────────────────────────────

/**
 * 创建 DB 桥接处理器 — 将总线事件持久化到 SQLite。
 *
 * 特殊事件处理：
 * - vote_passed + payload.act → 自动存储法案到 acts 表
 * - constitutional/unconstitutional + payload.verdict → 自动存储判决到 verdicts 表
 *
 * 内部 try-catch 保证单次持久化失败不影响其他桥接和核心 Pipeline。
 */
export function createDbBridge(taskStore: ITaskStore): Handler {
  return async function _dbBridge(event: BaseEvent): Promise<void> {
    if (!event.task_id) return;

    try {
      // Bug 56 fix: 确保将 event 中除了基础必填字段之外的所有扩展字段和 payload 统统序列化保存
      const { action: _a, source_agent: _sa, emotion: _e, intensity: _i, timestamp: _t, task_id: _ti, target_agent: _ta, ...extendedPayload } = event as Record<string, unknown>;
      const payloadStr = JSON.stringify(extendedPayload ?? {});
      const eventData = {
        sourceAgent: event.source_agent ?? 'unknown',
        action: typeof event.action === 'string' ? event.action : String(event.action),
        emotion: typeof event.emotion === 'string' ? event.emotion : 'neutral',
        intensity: typeof event.intensity === 'number' ? event.intensity : 0.5,
        payloadStr
      };

      let stateChange: string | undefined;
      if (event.action === EventAction.STATE_CHANGE && event.payload?.state) {
        stateChange = String(event.payload.state);
      }

      let actJson: string | undefined;
      if (event.action === EventAction.VOTE_PASSED && event.payload?.act) {
        actJson = JSON.stringify(event.payload.act);
      }

      let verdict: { constitutional: boolean, ruling: string, evidence: string } | undefined;
      if (
        (event.action === EventAction.CONSTITUTIONAL || event.action === EventAction.UNCONSTITUTIONAL) &&
        event.payload?.verdict
      ) {
        const verdictData = event.payload.verdict as Record<string, unknown>;
        verdict = {
          constitutional: Boolean(verdictData.constitutional ?? false),
          ruling: String(verdictData.ruling ?? ''),
          evidence: JSON.stringify(verdictData.evidence ?? [])
        };
      }

      if (taskStore.storeEventBatch) {
        // Bug 52 fix: Atomic transaction
        await taskStore.storeEventBatch(event.task_id, eventData, stateChange, actJson, verdict);
      } else {
        // Fallback
        await taskStore.storeEvent(
          event.task_id,
          eventData.sourceAgent,
          eventData.action,
          eventData.emotion,
          eventData.intensity,
          payloadStr,
        );
        if (stateChange) await taskStore.updateTask(event.task_id, { bill_state: stateChange });
        if (actJson) await taskStore.storeAct(event.task_id, actJson);
        if (verdict) await taskStore.storeVerdict(event.task_id, verdict.constitutional, verdict.ruling, verdict.evidence);
      }
    } catch (err) {
      console.error('[DB Bridge] Failed to store event:', err);
    }
  };
}

// ─── Run Petition ─────────────────────────────────────────────

/**
 * 后台执行 Pipeline — 替换 routes.ts 的 stub 占位逻辑。
 *
 * 状态机保证：PENDING → RUNNING → COMPLETED/FAILED
 * 绝不会停留在 RUNNING 状态（try-catch + finally 双保险）。
 */
export async function runPetition(
  taskId: string,
  prompt: string,
  state: AppState,
): Promise<void> {
  try {
    await state.taskStore.updateTask(taskId, { status: TaskStatus.RUNNING });

    const result = await state.government.receivePetition(prompt, undefined, taskId);

    // Bug 39+51 fix: receivePetition NEVER throws — it catches all errors and returns
    // error strings. Detect those robustly (not just Chinese prefixes) and mark as FAILED.
    // Key indicators: 系统级异常, 重试后仍未通过, 流水线已中止, 未完成
    const isSystemFailure = typeof result === 'string' && (
      result.startsWith('系统级异常') ||
      result.includes('次重试后仍未通过') ||
      result.includes('流水线已中止') ||
      result.includes('未完成') ||
      // Catch English-language exceptions from transport/OpenClawError
      /^(Error|OpenClawError|Transport):/i.test(result) ||
      // Fallback: if result doesn't start with '法案' (the success prefix), treat as failure
      (!result.startsWith('法案') && result.length < 200 && !result.includes('已交付'))
    );
    await state.taskStore.updateTask(taskId, {
      status: isSystemFailure ? TaskStatus.FAILED : TaskStatus.COMPLETED,
      result: result ?? 'Pipeline completed',
    });
  } catch (error) {
    // 保证最终状态一致性：任何异常都必须以 FAILED 终结
    // Bug 53 fix: Do not swallow error object stack trace
    const errorMsg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(`[Pipeline] Unhandled rejection for task ${taskId}:`, error);
    try {
      await state.taskStore.updateTask(taskId, {
        status: TaskStatus.FAILED,
        result: errorMsg,
      });
    } catch (updateErr) {
      console.error('[Pipeline] Failed to update task status to FAILED:', updateErr);
    }
  }
}

// ─── Lifecycle Management ─────────────────────────────────────

/**
 * 初始化生命周期 — 启动 Government + TaskStore + 注册 Bus 订阅。
 *
 * @returns shutdownLifecycle 闭包，用于优雅关闭
 */
export async function initLifecycle(state: AppState): Promise<() => Promise<void>> {
  // 启动核心组件
  await state.government.inaugurate();
  await state.taskStore.initialize();

  // 注册双通道桥接
  const TOPICS = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
  const wsBridge = createWsBridge(state.wsManager);
  const dbBridge = createDbBridge(state.taskStore);

  for (const topic of TOPICS) {
    state.government.bus.subscribe(topic, wsBridge);
    state.government.bus.subscribe(topic, dbBridge);
  }

  console.log('[Lifecycle] Pipeline 桥接已注册，双通道就绪');

  // 返回关闭函数
  return async function shutdownLifecycle(): Promise<void> {
    try {
      // 取消订阅（防止关闭期间还有事件触发写入已关闭的 DB）
      for (const topic of TOPICS) {
        try {
          state.government.bus.unsubscribe(topic, wsBridge);
          state.government.bus.unsubscribe(topic, dbBridge);
        } catch {
          // unsubscribe 可能因为已经被移除而抛错，忽略
        }
      }

      await state.government.shutdown();
      await state.taskStore.close();
      console.log('[Lifecycle] 优雅关闭完成');
    } catch (err) {
      console.error('[Lifecycle] Shutdown error:', err);
    }
  };
}
