/**
 * OpenClaw Republic — TypeScript Backend Entry Point
 *
 * Starts the TS API Server, WebSocket Server, and the internal CyberGovernment Pipeline.
 */

import { CyberGovernment } from './government';
import { TaskStore } from './server/task-store';
import { TaskQueue } from './server/task-queue';
import { ConnectionManager } from './server/ws-manager';
import { createApp, startServerWithWebSocket, type AppState } from './server/app';
import { initLifecycle } from './server/pipeline-bridge';

async function main() {
  console.log('🏛️  OpenClaw Republic — Initializing TypeScript Server...');

  // 1. 初始化依赖 (全局 State)
  const configDir = '../config'; // 假设以 backend 目录运行，对应父目录的 config
  const dbPath = 'data/tasks.db'; // SQlite 数据文件

  const state: AppState = {
    government: new CyberGovernment(configDir),
    taskStore: new TaskStore(dbPath),
    taskQueue: new TaskQueue(1), // 并发为 1
    wsManager: new ConnectionManager()
  };

  // 2. 初始化核心生命周期、加载配置、打开数据库、订阅总线事件
  const shutdownLifecycle = await initLifecycle(state);

  // 3. 构建 HTTP 应用
  const app = createApp(state);

  // 4. 启动 HTTP + WS Server
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
  const server = startServerWithWebSocket(app, state.wsManager, state, PORT);

  // 5. 优雅关闭钩子
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[Server] 收到关闭信号，准备清理资源...');

    // 关闭 HTTP 接收新请求并等待现有活跃请求处理完毕
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 主动断开所有的 WebSocket 连接（防止长连接导致 server.close 永远卡住）
    state.wsManager.closeAll();
    console.log('[Server] 所有 WebSocket 长连接已断开');

    // 优雅关闭 Government Pipeline 和数据库
    await shutdownLifecycle();

    try {
      // 容错: 给 HTTP 残留请求 5 秒时间进行完成，如果超时强行杀进程
      await Promise.race([
        closePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), 5000))
      ]);
      console.log('[Server] HTTP/WS 端口已停止监听，所有资源安全释放');
    } catch (e) {
      console.error('[Server] 强制关闭期间发生异常或超时:', e);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Fatal] Backend failed to start:', err);
  process.exit(1);
});
