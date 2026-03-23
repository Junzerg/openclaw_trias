/**
 * ConnectionManager 单元测试 — 验证 WS 连接分组管理、广播和死连接清理。
 *
 * 使用 mock WebSocket 对象，无需真实网络连接。
 */

import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionManager } from '../../src/server/ws-manager';

// ─── Mock WebSocket 工厂 ──────────────────────────────────────

/**
 * 创建最小化的 mock WebSocket 对象用于测试。
 * readyState = 1 (OPEN), send() 调用 callback 成功。
 */
function createMockWS(opts?: { readyState?: number; sendError?: Error }): WebSocket {
  const ws = {
    OPEN: 1,
    readyState: opts?.readyState ?? 1, // 默认 OPEN
    send: vi.fn((_data: string, cb?: (err?: Error) => void) => {
      if (opts?.sendError) {
        cb?.(opts.sendError);
      } else {
        cb?.();
      }
    }),
  } as unknown as WebSocket;
  return ws;
}

// ─── Tests ────────────────────────────────────────────────────

describe('ConnectionManager', () => {
  // ─── connect ────────────────────────────────────────────────

  describe('connect', () => {
    it('should register a connection and increase count', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);

      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should allow multiple connections for the same task', () => {
      const mgr = new ConnectionManager();
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      mgr.connect('task-1', ws1);
      mgr.connect('task-1', ws2);

      expect(mgr.getConnectionCount('task-1')).toBe(2);
    });

    it('should not double-add the same WebSocket instance', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      mgr.connect('task-1', ws);

      // Set 保证唯一性
      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should isolate connections between different tasks', () => {
      const mgr = new ConnectionManager();
      const wsA = createMockWS();
      const wsB = createMockWS();

      mgr.connect('task-A', wsA);
      mgr.connect('task-B', wsB);

      expect(mgr.getConnectionCount('task-A')).toBe(1);
      expect(mgr.getConnectionCount('task-B')).toBe(1);
    });
  });

  // ─── disconnect ─────────────────────────────────────────────

  describe('disconnect', () => {
    it('should remove a connection and decrease count', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      mgr.disconnect('task-1', ws);

      expect(mgr.getConnectionCount('task-1')).toBe(0);
    });

    it('should delete Map key when Set becomes empty (memory leak prevention)', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      expect(mgr.getConnectionCount('task-1')).toBe(1);

      mgr.disconnect('task-1', ws);
      // getConnectionCount returns 0, but more importantly the key is gone from the Map
      expect(mgr.getConnectionCount('task-1')).toBe(0);

      // 确认 Map key 实际被删除（通过内部检查）
      // 再连接+断开，验证 Manager 仍然正常工作
      mgr.connect('task-1', ws);
      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should be a no-op for non-existent task', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      // 不应抛异常
      mgr.disconnect('nonexistent', ws);
      expect(mgr.getConnectionCount('nonexistent')).toBe(0);
    });

    it('should be a no-op for WebSocket not in the set', () => {
      const mgr = new ConnectionManager();
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      mgr.connect('task-1', ws1);
      mgr.disconnect('task-1', ws2); // ws2 不在 Set 中

      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should only remove from the specified task, not other tasks', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-A', ws);
      mgr.connect('task-B', ws);

      mgr.disconnect('task-A', ws);

      expect(mgr.getConnectionCount('task-A')).toBe(0);
      expect(mgr.getConnectionCount('task-B')).toBe(1);
    });

    it('should be idempotent — calling disconnect twice should not throw', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      mgr.disconnect('task-1', ws);
      // 第二次 disconnect — 模拟 ws error + close 双触发场景
      mgr.disconnect('task-1', ws);

      expect(mgr.getConnectionCount('task-1')).toBe(0);
    });

    it('should actually delete Map key when Set is empty (not just leave empty Set)', () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      mgr.disconnect('task-1', ws);

      // 直接访问内部 _connections 验证 key 确实被删除
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internalMap = (mgr as any)._connections as Map<string, Set<unknown>>;
      expect(internalMap.has('task-1')).toBe(false);
    });
  });

  // ─── getConnectionCount ─────────────────────────────────────

  describe('getConnectionCount', () => {
    it('should return 0 for non-existent task', () => {
      const mgr = new ConnectionManager();
      expect(mgr.getConnectionCount('nobody')).toBe(0);
    });

    it('should return correct count after mixed operations', () => {
      const mgr = new ConnectionManager();
      const ws1 = createMockWS();
      const ws2 = createMockWS();
      const ws3 = createMockWS();

      mgr.connect('task-1', ws1);
      mgr.connect('task-1', ws2);
      mgr.connect('task-1', ws3);
      expect(mgr.getConnectionCount('task-1')).toBe(3);

      mgr.disconnect('task-1', ws2);
      expect(mgr.getConnectionCount('task-1')).toBe(2);
    });
  });

  // ─── broadcast ──────────────────────────────────────────────

  describe('broadcast', () => {
    it('should send JSON to all connections for a task', async () => {
      const mgr = new ConnectionManager();
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      mgr.connect('task-1', ws1);
      mgr.connect('task-1', ws2);

      await mgr.broadcast('task-1', { action: 'brawl', task_id: 'task-1' });

      const expected = JSON.stringify({ action: 'brawl', task_id: 'task-1' });
      expect(ws1.send).toHaveBeenCalledWith(expected, expect.any(Function));
      expect(ws2.send).toHaveBeenCalledWith(expected, expect.any(Function));
    });

    it('should be a no-op for non-existent task', async () => {
      const mgr = new ConnectionManager();

      // 不应抛异常
      await mgr.broadcast('nobody', { action: 'test' });
    });

    it('should be a no-op for task with empty connection set', async () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();

      mgr.connect('task-1', ws);
      mgr.disconnect('task-1', ws);

      // Set 已空并从 Map 删除
      await mgr.broadcast('task-1', { action: 'test' });
    });

    it('should auto-remove dead connections that fail during send', async () => {
      const mgr = new ConnectionManager();
      const goodWS = createMockWS();
      const deadWS = createMockWS({ sendError: new Error('Connection reset') });

      mgr.connect('task-1', goodWS);
      mgr.connect('task-1', deadWS);

      expect(mgr.getConnectionCount('task-1')).toBe(2);

      await mgr.broadcast('task-1', { action: 'test' });

      // 好的连接发送成功，死连接被移除
      expect(goodWS.send).toHaveBeenCalled();
      expect(deadWS.send).toHaveBeenCalled();
      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should auto-remove connections with non-OPEN readyState', async () => {
      const mgr = new ConnectionManager();
      const openWS = createMockWS();
      const closedWS = createMockWS({ readyState: 3 }); // CLOSED

      mgr.connect('task-1', openWS);
      mgr.connect('task-1', closedWS);

      await mgr.broadcast('task-1', { action: 'test' });

      // closedWS 应该不发送且被移除
      expect(closedWS.send).not.toHaveBeenCalled();
      expect(mgr.getConnectionCount('task-1')).toBe(1);
    });

    it('should clean up key from Map when all connections fail', async () => {
      const mgr = new ConnectionManager();
      const dead1 = createMockWS({ sendError: new Error('fail') });
      const dead2 = createMockWS({ readyState: 3 });

      mgr.connect('task-1', dead1);
      mgr.connect('task-1', dead2);

      await mgr.broadcast('task-1', { action: 'test' });

      expect(mgr.getConnectionCount('task-1')).toBe(0);
    });

    it('should not affect other tasks when cleaning dead connections', async () => {
      const mgr = new ConnectionManager();
      const goodWS = createMockWS();
      const deadWS = createMockWS({ sendError: new Error('fail') });

      mgr.connect('task-A', goodWS);
      mgr.connect('task-B', deadWS);

      // 广播到 task-B
      await mgr.broadcast('task-B', { action: 'test' });

      // task-A 不受影响
      expect(mgr.getConnectionCount('task-A')).toBe(1);
      expect(mgr.getConnectionCount('task-B')).toBe(0);
    });

    it('should serialize payload as valid JSON', async () => {
      const mgr = new ConnectionManager();
      const ws = createMockWS();
      mgr.connect('task-1', ws);

      const payload = {
        action: 'status_update',
        data: { status: 'running', bill_state: 'act' },
        timestamp: 1234567890,
      };

      await mgr.broadcast('task-1', payload);

      const sentData = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const parsed = JSON.parse(sentData as string);
      expect(parsed).toEqual(payload);
    });
  });
});
