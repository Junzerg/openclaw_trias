/**
 * Express 应用骨架 — 翻译自 Python server/app.py。
 *
 * createApp() 工厂函数创建并配置 Express 应用。
 * TaskStore / TaskQueue 的完整实现由 Task 2.2 提供，
 * ConnectionManager 由 Task 2.3 提供。
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { CyberGovernment } from '../government';
import { createRouter } from './routes';
import { handleWebSocketConnection } from './websocket';
import type { ConnectionManager } from './ws-manager';

// ─── Stub 接口（将由 Task 2.2 / 2.3 替换为真实实现）─────────────

/** 任务执行状态枚举 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** 任务记录 */
export interface TaskRecord {
  task_id: string;
  petition: string;
  status: TaskStatus;
  bill_state: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

/** 任务持久化存储（Task 2.2 实现） */
export interface ITaskStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createTask(taskId: string, petition: string): Promise<void>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  updateTask(taskId: string, update: Partial<Pick<TaskRecord, 'status' | 'result' | 'bill_state'>>): Promise<void>;
  countTasks(): Promise<number>;
  listTasks(offset: number, limit: number): Promise<TaskRecord[]>;
  getTaskAct(taskId: string): Promise<{ act_json: string; created_at: string } | null>;
  getTaskEvents(taskId: string): Promise<Array<{ action: string; source_agent: string; payload: string }>>;
  getTaskVerdict(taskId: string): Promise<{
    constitutional: number;
    ruling: string;
    evidence: string;
    created_at: string;
  } | null>;

  // ─── 写入方法（Task 2.4 桥接使用）─────────────────────────────
  storeEvent(taskId: string, sourceAgent: string, action: string, emotion: string, intensity: number, payload: string): Promise<void>;
  storeEventBatch?(
    taskId: string,
    eventData: { sourceAgent: string, action: string, emotion: string, intensity: number, payloadStr: string },
    stateChange?: string,
    actJson?: string,
    verdict?: { constitutional: boolean, ruling: string, evidence: string }
  ): Promise<void>;
  storeAct(taskId: string, actJson: string): Promise<void>;
  storeVerdict(taskId: string, constitutional: boolean, ruling: string, evidence: string): Promise<void>;
}

/** 任务队列（Task 2.2 实现） */
export interface ITaskQueue {
  submit(taskId: string, taskFactory: () => Promise<void>): Promise<void>;
}

/** WebSocket 连接管理器（Task 2.3 实现） */
export interface IConnectionManager {
  connect(taskId: string, ws: import('ws').WebSocket): void;
  disconnect(taskId: string, ws: import('ws').WebSocket): void;
  broadcast(taskId: string, payload: Record<string, unknown>): Promise<void>;
  getConnectionCount(taskId: string): number;
  closeAll(): void;
  /** Task 4.8: 查询断线期间遗漏的事件用于补发 */
  getEventsAfter(taskId: string, afterEventId: number): import('./ws-manager').BufferedEvent[];
}

// ─── AppState ──────────────────────────────────────────────────

export interface AppState {
  government: CyberGovernment;
  taskStore: ITaskStore;
  taskQueue: ITaskQueue;
  wsManager: IConnectionManager;
}

// ─── App Factory ───────────────────────────────────────────────

/**
 * 创建并配置 Express 应用实例。
 *
 * @param state - 全局应用状态（注入 government、taskStore 等依赖）
 * @returns 配置好的 Express 应用
 */
export function createApp(state: AppState): Express {
  const app = express();

  // CORS — 严格对齐 Python 版，允许所有方法和头，防止前端 Preflight 失败
  // 使用显式 Methods 列表而不用 '*' 是为了兼容严格的老型浏览器（如 Safari 等部分版本禁用了 '*' 作为 method 通配符）
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: '*'
  }));

  // JSON body parser — 限制 1MB 防止 DoS
  app.use(express.json({ limit: '1mb' }));

  // 将 state 挂载到 app.locals 以便路由访问
  app.locals.state = state;

  // 注册 REST 路由
  const router = createRouter();
  app.use(router);

  // 兜底 404：如果没有任何路由匹配，必须返回 JSON 而不是 Express 默认的 HTML
  // 防止前端 JSON.parse() 遇到 `<!DOCTYPE html>` 时抛出异常白屏
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found', detail: 'Endpoint does not exist' });
  });

  // 全局错误处理中间件（Express 5 原生捕获 async rejection，此为兜底 + 格式化）
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // 关键 Express 机制：如果流已部分发送，遇到异常不能吞噬，必须交给 Express 默认终极 handler 以强行关闭底层 TCP Socket 释放死连接
    if (res.headersSent) {
      return _next(err);
    }

    const status = (err as any).status || (err as any).statusCode || 500;
    if (status === 500) {
      console.error('Unhandled route error:', err);
    }

    res.status(status).json({
      error: status === 500 ? 'Internal Server Error' : 'Bad Request',
      detail: err.message
    });
  });

  return app;
}

// ─── Server Startup ────────────────────────────────────────────

/**
 * 启动 HTTP 服务器监听（不含 WebSocket 支持）。
 *
 * @param app - Express 应用
 * @param port - 监听端口
 * @returns HTTP Server 实例
 */
export function startServer(app: Express, port: number = 8000) {
  return app.listen(port, () => {
    console.log(`OpenClaw Republic API 已启动，监听端口 ${port}`);
  });
}

/**
 * 启动 HTTP 服务器 + WebSocket 升级支持。
 *
 * 关键防雷 3（升级竞态）：
 * upgrade handler 在 server.listen() 之前注册，
 * 否则 HTTP 请求会先被 Express 吞掉返回 404。
 *
 * @param app - Express 应用
 * @param wsManager - WebSocket 连接管理器
 * @param appState - 全局应用状态
 * @param port - 监听端口
 * @returns HTTP Server 实例
 */
export function startServerWithWebSocket(
  app: Express,
  wsManager: IConnectionManager,
  appState: AppState,
  port: number = 8000,
): Server {
  const server = createServer(app);

  // noServer 模式 — 手动控制 WS 升级
  // 防雷 4: 限制 maxPayload 为 64KB（1MB对WS单帧过大，防 JSON.parse 阻塞 Event Loop）
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024
  });

  // 关键：在 listen() 之前注册 upgrade handler
  server.on('upgrade', (request, socket, head) => {
    // 防雷 6: 拦截裸 TCP Socket 在握手期间可能抛出的异常 (如 ECONNRESET)，避免 unhandled error 崩溃进程
    socket.on('error', (err) => {
      console.debug('[WS Upgrade] TCP Socket error ignored:', err.message);
    });

    // 解析 URL，剥离 query string 再匹配路径
    // 防止 taskId 被 ?token=xxx 等查询参数污染
    const pathname = request.url?.split('?')[0] ?? '';
    const match = pathname.match(/^\/ws\/task\/(.+)$/);

    if (match) {
      // 防雷 11: 跨协议状态脱节 (Cross-Protocol Desync) & URI 异常攻击
      // HTTP 框架会自动 decode URI，但裸 WebSocket 升级事件接收到的是未经 decode 的 raw URL。
      // 如果包含空格或特殊字符，会导致 REST 记录的 Task ID 和 WebSocket 这里注册的 Task ID 不相符！
      // 必须手动 decode，且需防范恶意乱码导致的进程同步崩溃 (URIError)。
      let decodedTaskId: string;
      try {
        decodedTaskId = decodeURIComponent(match[1]);
      } catch {
        socket.destroy(); // 静默击杀，不通过 console 打印防止原始的 ANSI 乱码污染终端
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleWebSocketConnection(ws, decodedTaskId, wsManager, appState);
      });
    } else {
      // 非法路径的升级请求直接销毁 socket
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`OpenClaw Republic API + WebSocket 已启动，监听端口 ${port}`);
  });

  return server;
}
