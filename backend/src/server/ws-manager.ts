/**
 * WebSocket 连接管理器 — 翻译自 Python ws_manager.py。
 *
 * 按 task_id 分组管理 WebSocket 连接，支持广播事件到订阅同一任务的所有客户端。
 */

import type { WebSocket } from 'ws';
import type { IConnectionManager } from './app';

export class ConnectionManager implements IConnectionManager {
  /** task_id → 该任务的活跃 WebSocket 连接集合 */
  private readonly _connections = new Map<string, Set<WebSocket>>();

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
    if (conns.size === 0) {
      this._connections.delete(taskId);
    }
  }

  /**
   * 向指定 task_id 的所有连接广播事件。
   *
   * 关键防雷 9: (慢读取者 DoS / Pipeline 死锁)
   * 我们 **绝不能 await** 每一个 socket 的发送完成！
   * 如果攻击者制造“Slow Reader”（故意不消费 TCP 缓冲区），
   * ws.send 的回调将永远卡住，导致 Promise 泄漏并挂起核心业务 Pipeline 的执行。
   */
  async broadcast(taskId: string, payload: Record<string, unknown>): Promise<void> {
    const conns = this._connections.get(taskId);
    if (!conns || conns.size === 0) return;

    let message: string;
    try {
      message = JSON.stringify(payload);
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
   * 获取指定任务的活跃连接数。
   */
  getConnectionCount(taskId: string): number {
    return this._connections.get(taskId)?.size ?? 0;
  }
}
