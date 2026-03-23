/**
 * WebSocket 端点处理单元测试 — 验证 ping/pong、new_task、debug_* 和恶意消息防御。
 *
 * 使用真实的 ws 客户端连接到临时 HTTP+WS 服务器，端到端验证消息流。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ConnectionManager } from '../../src/server/ws-manager';
import { handleWebSocketConnection } from '../../src/server/websocket';
import type { AppState, ITaskStore, ITaskQueue } from '../../src/server/app';
import type { CyberGovernment } from '../../src/government';

// ─── 辅助工具 ──────────────────────────────────────────────────

/** 等待客户端接收到下一条消息，带超时保护 */
function waitForMessage(client: WebSocket, timeoutMs = 2000): Promise<string> {
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

/** 等待 WebSocket 客户端打开 */
function waitForOpen(client: WebSocket, timeoutMs = 2000): Promise<void> {
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

/** 等待小段时间 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 测试服务器搭建 ──────────────────────────────────────────────

/**
 * 创建临时 HTTP+WS 测试服务器。
 * 路径匹配 /ws/task/:id，非法路径 → socket.destroy()。
 */
function createTestServer(
  wsManager: ConnectionManager,
  appState: AppState,
): { server: Server; port: number; close: () => Promise<void> } {
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

  // 使用端口 0 让 OS 分配随机可用端口
  server.listen(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const close = () =>
    new Promise<void>((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });

  return { server, port, close };
}

// ─── Mock AppState ──────────────────────────────────────────────

function createMockAppState(wsManager: ConnectionManager): AppState {
  const mockStore: ITaskStore = {
    initialize: async () => {},
    close: async () => {},
    createTask: async () => {},
    getTask: async () => null,
    updateTask: async () => {},
    countTasks: async () => 0,
    listTasks: async () => [],
    getTaskAct: async () => null,
    getTaskEvents: async () => [],
    getTaskVerdict: async () => null,
    storeEvent: async () => {},
    storeAct: async () => {},
    storeVerdict: async () => {},
  };

  const mockQueue: ITaskQueue = {
    submit: async () => {},
  };

  return {
    government: {} as CyberGovernment,
    taskStore: mockStore,
    taskQueue: mockQueue,
    wsManager: wsManager,
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('WebSocket Endpoint', () => {
  let wsManager: ConnectionManager;
  let appState: AppState;
  let testServer: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    wsManager = new ConnectionManager();
    appState = createMockAppState(wsManager);
    testServer = createTestServer(wsManager, appState);
  });

  afterEach(async () => {
    await testServer.close();
  });

  // ─── 连接建立 ─────────────────────────────────────────────

  describe('connection establishment', () => {
    it('should accept WebSocket connection on /ws/task/:id', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      expect(client.readyState).toBe(WebSocket.OPEN);
      expect(wsManager.getConnectionCount('test-123')).toBe(1);

      client.close();
      await sleep(50);
    });

    it('should destroy socket for invalid WS path', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/invalid/path`);

      await new Promise<void>((resolve) => {
        client.on('error', () => resolve());
        client.on('close', () => resolve());
      });

      // 连接不应该建立成功
      expect(client.readyState).not.toBe(WebSocket.OPEN);
    });

    it('should register to correct task_id', async () => {
      const client1 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/task-A`);
      const client2 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/task-B`);

      await Promise.all([waitForOpen(client1), waitForOpen(client2)]);

      expect(wsManager.getConnectionCount('task-A')).toBe(1);
      expect(wsManager.getConnectionCount('task-B')).toBe(1);

      client1.close();
      client2.close();
      await sleep(50);
    });

    it('should strip query string from URL when extracting task_id', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-456?token=abc&foo=bar`);
      await waitForOpen(client);

      // taskId should be 'test-456', not 'test-456?token=abc&foo=bar'
      expect(wsManager.getConnectionCount('test-456')).toBe(1);
      expect(wsManager.getConnectionCount('test-456?token=abc&foo=bar')).toBe(0);

      client.close();
      await sleep(50);
    });
  });

  // ─── ping/pong 心跳 ────────────────────────────────────────

  describe('ping/pong heartbeat', () => {
    it('should respond with { type: "pong" } when receiving "ping"', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      const msgPromise = waitForMessage(client);
      client.send('ping');

      const response = await msgPromise;
      expect(JSON.parse(response)).toEqual({ type: 'pong' });

      client.close();
      await sleep(50);
    });
  });

  // ─── new_task 控制指令 ──────────────────────────────────────

  describe('new_task command', () => {
    it('should call taskStore.createTask with the provided prompt', async () => {
      const createTaskSpy = async (taskId: string, petition: string) => {
        expect(taskId).toBe('test-123');
        expect(petition).toBe('Build a TODO app');
      };
      appState.taskStore.createTask = createTaskSpy;

      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send(JSON.stringify({ action: 'new_task', data: { prompt: 'Build a TODO app' } }));

      // 等待异步处理完成
      await sleep(100);

      client.close();
      await sleep(50);
    });

    it('should silently ignore new_task without prompt', async () => {
      let createCalled = false;
      appState.taskStore.createTask = async () => {
        createCalled = true;
      };

      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send(JSON.stringify({ action: 'new_task', data: {} }));
      await sleep(100);

      expect(createCalled).toBe(false);

      client.close();
      await sleep(50);
    });

    it('should handle createTask failure gracefully', async () => {
      appState.taskStore.createTask = async () => {
        throw new Error('UNIQUE constraint failed');
      };

      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      // 不应该崩溃服务器
      client.send(JSON.stringify({ action: 'new_task', data: { prompt: 'test' } }));
      await sleep(100);

      // 连接应该仍然存活
      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });

    it('should silently ignore new_task with data as null', async () => {
      let createCalled = false;
      appState.taskStore.createTask = async () => {
        createCalled = true;
      };

      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send(JSON.stringify({ action: 'new_task', data: null }));
      await sleep(100);

      expect(createCalled).toBe(false);

      client.close();
      await sleep(50);
    });

    it('should silently ignore new_task with data as string', async () => {
      let createCalled = false;
      appState.taskStore.createTask = async () => {
        createCalled = true;
      };

      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send(JSON.stringify({ action: 'new_task', data: 'not an object' }));
      await sleep(100);

      expect(createCalled).toBe(false);

      client.close();
      await sleep(50);
    });
  });

  // ─── debug_* 调试指令 ──────────────────────────────────────

  describe('debug_* commands', () => {
    it('should broadcast debug_brawl as brawl event', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      // 发送 debug 指令后，应该通过广播收到转换后的事件
      const msgPromise = waitForMessage(client);
      client.send(JSON.stringify({ action: 'debug_brawl' }));

      const response = JSON.parse(await msgPromise);
      expect(response.action).toBe('brawl');
      expect(response.task_id).toBe('test-123');

      client.close();
      await sleep(50);
    });

    it('should merge data from debug command into broadcast event', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      const msgPromise = waitForMessage(client);
      client.send(
        JSON.stringify({
          action: 'debug_vote',
          data: { result: 'approve', vote_count: 42 },
        }),
      );

      const response = JSON.parse(await msgPromise);
      expect(response.action).toBe('vote');
      expect(response.task_id).toBe('test-123');
      expect(response.result).toBe('approve');
      expect(response.vote_count).toBe(42);

      client.close();
      await sleep(50);
    });

    it('should broadcast debug event to multiple clients', async () => {
      const client1 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      const client2 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);

      await Promise.all([waitForOpen(client1), waitForOpen(client2)]);

      const msg1Promise = waitForMessage(client1);
      const msg2Promise = waitForMessage(client2);

      client1.send(JSON.stringify({ action: 'debug_speaker_order' }));

      const [r1, r2] = await Promise.all([msg1Promise, msg2Promise]);
      expect(JSON.parse(r1).action).toBe('speaker_order');
      expect(JSON.parse(r2).action).toBe('speaker_order');

      client1.close();
      client2.close();
      await sleep(50);
    });

    it('should handle debug_ with empty suffix (edge case)', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      const msgPromise = waitForMessage(client);
      client.send(JSON.stringify({ action: 'debug_' }));

      const response = JSON.parse(await msgPromise);
      // realAction = '' — 不会崩溃，只是 action 为空
      expect(response.action).toBe('');
      expect(response.task_id).toBe('test-123');

      client.close();
      await sleep(50);
    });

    it('should not merge data when it is an array', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      const msgPromise = waitForMessage(client);
      client.send(
        JSON.stringify({
          action: 'debug_test',
          data: [1, 2, 3], // 数组不应该被 Object.assign
        }),
      );

      const response = JSON.parse(await msgPromise);
      expect(response.action).toBe('test');
      expect(response.task_id).toBe('test-123');
      // 数组类型的 data 被过滤掉，不应出现在广播事件中
      expect(response['0']).toBeUndefined();

      client.close();
      await sleep(50);
    });
  });

  // ─── 恶意消息防御 ──────────────────────────────────────────

  describe('malicious message defense', () => {
    it('should not crash on non-JSON text', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      // 发送非 JSON 文本
      client.send('this is not json');
      await sleep(100);

      // 连接应该仍然存活
      expect(client.readyState).toBe(WebSocket.OPEN);

      // ping 仍然能工作
      const msgPromise = waitForMessage(client);
      client.send('ping');
      const response = JSON.parse(await msgPromise);
      expect(response.type).toBe('pong');

      client.close();
      await sleep(50);
    });

    it('should not crash on JSON array (invalid format)', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send('[1, 2, 3]');
      await sleep(100);

      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });

    it('should not crash on JSON null', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send('null');
      await sleep(100);

      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });

    it('should not crash on empty string', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send('');
      await sleep(100);

      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });

    it('should not crash on binary data', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      // 发送二进制数据
      client.send(Buffer.from([0x00, 0x01, 0x02, 0x03]));
      await sleep(100);

      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });

    it('should handle JSON without action field gracefully', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      client.send(JSON.stringify({ foo: 'bar' }));
      await sleep(100);

      // 连接仍然存活
      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
      await sleep(50);
    });
  });

  // ─── 连接关闭清理 ──────────────────────────────────────────

  describe('connection cleanup', () => {
    it('should clean up connection on client close', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      await waitForOpen(client);

      expect(wsManager.getConnectionCount('test-123')).toBe(1);

      client.close();
      await sleep(100); // 等待 close 事件传播

      expect(wsManager.getConnectionCount('test-123')).toBe(0);
    });

    it('should handle multiple clients disconnecting independently', async () => {
      const client1 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);
      const client2 = new WebSocket(`ws://127.0.0.1:${testServer.port}/ws/task/test-123`);

      await Promise.all([waitForOpen(client1), waitForOpen(client2)]);
      expect(wsManager.getConnectionCount('test-123')).toBe(2);

      // 只关闭一个
      client1.close();
      await sleep(100);

      expect(wsManager.getConnectionCount('test-123')).toBe(1);

      // 关闭第二个
      client2.close();
      await sleep(100);

      expect(wsManager.getConnectionCount('test-123')).toBe(0);
    });
  });
});
