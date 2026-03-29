/**
 * WebSocket 连接管理器 — 翻译自 Python ws_manager.py。
 *
 * 按 task_id 分组管理 WebSocket 连接，支持广播事件到订阅同一任务的所有客户端。
 *
 * Task 4.8: 新增 Ring Buffer 事件缓冲 + event_id 全局递增计数器，
 * 支持断线重连后自动补发遗漏事件。
 */

import type { WebSocket } from 'ws';
import type { IConnectionManager } from './app';

/** Ring Buffer 中存储的历史事件条目 */
export interface BufferedEvent {
  event_id: number;
  payload: Record<string, unknown>;
}

/** 每个 task 的 Ring Buffer 最大容量 */
const RING_BUFFER_CAPACITY = 500;

export class ConnectionManager implements IConnectionManager {
  /** task_id → 该任务的活跃 WebSocket 连接集合 */
  private readonly _connections = new Map<string, Set<WebSocket>>();

  /**
   * Task 4.8: 每个 task 的事件历史环形缓冲区。
   * 当数组长度超过 RING_BUFFER_CAPACITY 时，旧事件从头部移出。
   */
  private readonly _historyBuffer = new Map<string, BufferedEvent[]>();

  /**
   * Task 4.8: 每个 task 的全局递增 event_id 计数器。
   */
  private readonly _eventCounters = new Map<string, number>();

  /**
   * Track last activity time for periodic cleanup to prevent memory leaks
   */
  private readonly _lastActive = new Map<string, number>();

  constructor() {
    // Sweep stale tasks (no activity for > 1 hour) every 30 minutes
    setInterval(() => this.sweepStaleTasks(), 30 * 60 * 1000).unref();
  }

  private sweepStaleTasks(): void {
    const now = Date.now();
    for (const [taskId, lastTime] of this._lastActive.entries()) {
      // If idle for more than 1 hour
      if (now - lastTime > 60 * 60 * 1000) {
        const conns = this._connections.get(taskId);
        // Safely garbage collect if there are no active connections
        if (!conns || conns.size === 0) {
          this._historyBuffer.delete(taskId);
          this._eventCounters.delete(taskId);
          this._connections.delete(taskId);
          this._lastActive.delete(taskId);
          console.debug(`[WS Manager] Garbage collected stale task resources: ${taskId}`);
        }
      }
    }
  }

  /**
   * 注册一个 WebSocket 连接到指定 task_id。
   *
   * 与 Python 版差异：不需要 `await ws.accept()`，
   * `ws` 包的 `handleUpgrade` 已经完成了握手。
   */
  connect(taskId: string, ws: WebSocket): void {
    let conns = this._connections.get(taskId);
    if (!conns) {
      conns = new Set<WebSocket>();
      this._connections.set(taskId, conns);
    }

    // 防雷 8: 惊群效应防线 (防单点任务海量连接导致的 Broadcast 内存崩溃)
    // 限制单 task_id 最多 100 个并发监听者，超出则拒绝服务
    if (conns.size >= 100) {
      console.warn('[WS] Thundering herd protected: task %j reached 100 connections. Dropping new connection.', taskId);
      ws.close(1013, 'Try again later'); // 1013 = Try Again Later (RFC 6455)
      return;
    }

    conns.add(ws);
    this._lastActive.set(taskId, Date.now());
  }

  /**
   * 移除断开的连接。
   *
   * 关键防雷：如果 Set 为空，必须从 Map 中删除 key，
   * 否则 Map 会无限增长导致内存泄漏。
   */
  disconnect(taskId: string, ws: WebSocket): void {
    const conns = this._connections.get(taskId);
    if (!conns) return;

    conns.delete(ws);

    // 空 Set 必须从 Map 中移除，防止内存泄漏
    // 注意：这里不要 delete buffer，保持 buffer 供后续重连使用
    // buffer 将由 sweepStaleTasks 根据 1小时 TTL 自动回收
    if (conns.size === 0) {
      this._connections.delete(taskId);
    }
    
    this._lastActive.set(taskId, Date.now());
  }

  /**
   * 向指定 task_id 的所有连接广播事件。
   *
   * Task 4.8 增强：
   * 1. 为该 task 的 counter 加 1，生成 event_id
   * 2. 将 event_id 注入到 payload 中
   * 3. 将附带 event_id 的 payload 压入 Ring Buffer
   * 4. Fire and Forget 广播给所有 client
   *
   * 关键防雷 9: (慢读取者 DoS / Pipeline 死锁)
   * 我们 **绝不能 await** 每一个 socket 的发送完成！
   * 如果攻击者制造"Slow Reader"（故意不消费 TCP 缓冲区），
   * ws.send 的回调将永远卡住，导致 Promise 泄漏并挂起核心业务 Pipeline 的执行。
   */
  async broadcast(taskId: string, payload: Record<string, unknown>): Promise<void> {
    this._lastActive.set(taskId, Date.now()); // Update activity timestamp

    // ─── Task 4.8: event_id 递增 & 注入 ───────────────────────────
    const currentCounter = (this._eventCounters.get(taskId) ?? 0) + 1;
    this._eventCounters.set(taskId, currentCounter);

    // 注入 event_id 到 payload 中（不修改原始对象，创建新引用）
    const enrichedPayload: Record<string, unknown> = { ...payload, event_id: currentCounter };

    // ─── Task 4.8: 写入 Ring Buffer ────────────────────────────────
    let buffer = this._historyBuffer.get(taskId);
    if (!buffer) {
      buffer = [];
      this._historyBuffer.set(taskId, buffer);
    }

    buffer.push({ event_id: currentCounter, payload: enrichedPayload });

    // 超出容量时移除最旧的事件（从头部截断）
    if (buffer.length > RING_BUFFER_CAPACITY) {
      // 批量截断（如果因为某种原因积压超过 1 条，一次性清到容量线）
      const overflow = buffer.length - RING_BUFFER_CAPACITY;
      buffer.splice(0, overflow);
    }

    // ─── 广播给所有活跃客户端 ──────────────────────────────────────
    const conns = this._connections.get(taskId);
    if (!conns || conns.size === 0) return;

    let message: string;
    try {
      message = JSON.stringify(enrichedPayload);
    } catch {
      return; // 忽略不可序列化的畸形载荷
    }

    // 快照当前连接集合，防止遍历期间被并发修改
    const snapshot = [...conns];

    // Fire and Forget 分发模式
    for (const ws of snapshot) {
      if (ws.readyState !== ws.OPEN) {
        this.disconnect(taskId, ws);
        continue;
      }

      // 如果客户端一直不消费数据导致 Node 服务端内存积压超 512KB，
      // 判定为恶意挂机，直接物理剪断以防堆内存 OOM
      if (ws.bufferedAmount > 512 * 1024) {
        console.warn('[WS] Slow reader detected (task=%j). Terminating to prevent OOM.', taskId);
        ws.terminate();
        this.disconnect(taskId, ws);
        continue;
      }

      ws.send(message, (err) => {
        // TCP 层面如果抛出发送失败，在这边异步清理
        if (err) {
          this.disconnect(taskId, ws);
        }
      });
    }
  }

  /**
   * Task 4.14: 轻量级直接广播 — 用于高频流式事件 (STREAM_CHUNK)。
   *
   * 与 broadcast() 的区别：
   * - 不分配 event_id（不参与断线重连的 replay 补发）
   * - 不写入 Ring Buffer（不占用历史缓存空间）
   * - 不更新 _lastActive（不影响 GC 定时器）
   *
   * 这确保极高频的 Token 流不会把重要的业务事件挤出 Ring Buffer。
   */
  async broadcastDirect(taskId: string, payload: Record<string, unknown>): Promise<void> {
    const conns = this._connections.get(taskId);
    if (!conns || conns.size === 0) return;

    let message: string;
    try {
      message = JSON.stringify(payload);
    } catch {
      return;
    }

    const snapshot = [...conns];
    for (const ws of snapshot) {
      if (ws.readyState !== ws.OPEN) {
        this.disconnect(taskId, ws);
        continue;
      }

      // Same slow-reader protection as broadcast
      if (ws.bufferedAmount > 512 * 1024) {
        console.warn('[WS] Slow reader detected during streaming (task=%j). Terminating.', taskId);
        ws.terminate();
        this.disconnect(taskId, ws);
        continue;
      }

      ws.send(message, (err) => {
        if (err) this.disconnect(taskId, ws);
      });
    }
  }

  /**
   * Task 4.8: 查询指定 task 在 afterEventId 之后的所有缓冲事件。
   *
   * 用于断线重连后的事件补发（Replay）。
   *
   * @param taskId - 任务 ID
   * @param afterEventId - 客户端最后收到的 event_id，返回所有 > afterEventId 的事件
   * @returns 按 event_id 升序排列的事件数组
   */
  getEventsAfter(taskId: string, afterEventId: number): BufferedEvent[] {
    const buffer = this._historyBuffer.get(taskId);
    if (!buffer || buffer.length === 0) return [];

    // 由于 buffer 中的 event_id 是严格递增的，可以用二分搜索优化，
    // 但 500 条的上限使得线性过滤完全足够
    return buffer.filter((event) => event.event_id > afterEventId);
  }

  /**
   * 获取指定任务的活跃连接数。
   */
  getConnectionCount(taskId: string): number {
    return this._connections.get(taskId)?.size ?? 0;
  }

  /**
   * 优雅关闭所有活跃的 WebSocket 连接。
   */
  closeAll(): void {
    for (const conns of this._connections.values()) {
      for (const ws of conns) {
        if (ws.readyState === ws.OPEN) {
          ws.close(1012, 'Service Restart');
        }
      }
    }
    this._connections.clear();
  }
}
