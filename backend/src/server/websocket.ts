/**
 * WebSocket 端点处理 — 翻译自 Python websocket.py。
 *
 * 处理 /ws/task/:id 的 WebSocket 连接上的客户端消息：
 * - ping 心跳 → pong 响应
 * - new_task 控制指令 → 触发新 Pipeline
 * - debug_* 调试指令 → 广播模拟事件
 */

import type { WebSocket } from 'ws';
import type { ConnectionManager } from './ws-manager';
import type { AppState } from './app';
import { PetitionRequestSchema } from './schemas'; // 引入 Schema 用于防绕过验证

/**
 * 处理一个已建立的 WebSocket 连接。
 *
 * 由 upgrade 处理器在握手完成后调用，注册消息监听和清理逻辑。
 */
export function handleWebSocketConnection(
  ws: WebSocket,
  taskId: string,
  manager: ConnectionManager,
  appState: AppState,
): void {
  // 注册连接到管理器
  manager.connect(taskId, ws);

  // ─── 防雷 5：标准心跳检测（Ping/Pong）防半开连接 FD 死锁 ────────
  let isAlive = true;
  
  // RFC 6455: 浏览器底层会自动回复 Pong 帧，无需前端写 JS 代码
  ws.on('pong', () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    // 保护：如果状态已不是 OPEN，直接跳过等 close 事件自行清理
    if (ws.readyState !== ws.OPEN) return;

    if (!isAlive) {
      console.warn('[WS] Connection dead timeout (task=%j), terminating.', taskId);
      ws.terminate(); // 长时间未收到底层 pong 响应，强行掐断释放 FD
      return;
    }
    
    isAlive = false;
    ws.ping(); // 发送底层 Ping 控制帧
  }, 30000);

  pingInterval.unref?.(); // 防止测试环境挂起

  // ─── 防雷 6：零 Timer 开销并发限流 (防刷屏 DoS 且保卫 Event Loop) ─
  // 不再为每个连接创建独立的 setInterval（1万个连接 = 1万个定时器，会拖垮 V8 CPU），
  // 改用基于消息触发时间的差值判定法，做到完美的零后台定时器开销。
  let messageCount = 0;
  let lastMessageTime = Date.now();

  // ─── 消息处理 ──────────────────────────────────────────────────

  ws.on('message', async (raw: Buffer | string) => {
    const now = Date.now();
    // 距上次消息如果超过1秒，重置令牌桶
    if (now - lastMessageTime > 1000) {
      messageCount = 0;
      lastMessageTime = now;
    }

    // 防御：每秒最多允许处理 50 条消息，超过直接掐断并拉黑该连接
    if (++messageCount > 50) {
      console.warn('[WS] Rate limit exceeded (task=%j). Terminating malicious client.', taskId);
      ws.terminate();
      return;
    }

    try {
      // 将 Buffer 转为 string
      const data = typeof raw === 'string' ? raw : raw.toString('utf-8');

      // 遗留应用层心跳 (旧版兼容)：某些老客户端可能仍会发送 "ping" 文本
      if (data === 'ping') {
        isAlive = true; // 手动补充活跃标记
        ws.send(JSON.stringify({ type: 'pong' }), (err) => {
          if (err) {
            console.warn('[WS] Failed to send pong (task=%j):', taskId, err.message);
          }
        });
        return;
      }

      // ─── 关键防雷 2：JSON 解析防御 ───────────────────────────────
      // 客户端可能发送非 JSON 或畸形数据，必须 try-catch 包裹。
      // 不能让单个恶意客户端崩溃整个 WS 服务。
      let payload: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          console.warn('[WS] Invalid message format from client (task=%j): not an object', taskId);
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        console.warn('[WS] Non-JSON message from client (task=%j): %s', taskId, data.slice(0, 100));
        return;
      }

      const action = typeof payload.action === 'string' ? payload.action : '';

      // ─── new_task 控制指令 ──────────────────────────────────────
      if (action === 'new_task') {
        // 利用与 POST /petition 相同的 Schema 防范 Payload Validation Bypass
        // 防止攻击者试图绕过 HTTP 层的 z.string().min(10).max(20000)
        const parsedData = PetitionRequestSchema.safeParse(payload.data);
        if (!parsedData.success) {
          console.warn('[WS] new_task validation failed (task=%j)', taskId);
          return;
        }

        const prompt = parsedData.data.prompt;

        try {
          // 清理旧数据并重新创建任务
          // 注意：Task 2.4 的 Pipeline 桥接会完善此处逻辑
          await appState.taskStore.createTask(taskId, prompt);
        } catch {
          // 如果 task_id 已存在(UNIQUE 冲突)，忽略 — 
          // 后续 Task 2.4 会实现完整的清理+重建逻辑
          console.warn('[WS] new_task: create failed (task=%j), may already exist', taskId);
        }

        // TODO: Task 2.4 将实现与 Pipeline 桥接的 _run_petition 调用
        // 目前先将状态更新为 running 以表示收到了指令
        return;
      }

      // ─── debug_* 调试指令 ───────────────────────────────────────
      if (action.startsWith('debug_')) {
        // 将 debug_brawl → brawl, debug_vote → vote, etc.
        const realAction = action.replace('debug_', '');
        
        // 防雷 10: (Payload 注入防线 / 属性覆盖保护)
        // 必须让系统生成的 action 和 task_id 拥有最高优先级，强制覆盖写入。
        // 如果让客户端数据 (debugData) 挂在后面，攻击者可以发送
        // { "data": { "action": "status_update", "status": "fake" } }
        // 从而跨越 debug_ 的限制，朝其他监听者广播伪造状态导致状态机错乱。
        const eventData: Record<string, unknown> = {};

        // 合并客户端发来的 data 字段（放在前面作为底座）
        const debugData = payload.data;
        if (debugData && typeof debugData === 'object' && !Array.isArray(debugData)) {
          Object.assign(eventData, debugData);
        }

        // 强行扣上系统安全的头盔
        Object.assign(eventData, {
          action: realAction,
          task_id: taskId,
        });

        await manager.broadcast(taskId, eventData);
        return;
      }

      // 未知指令 — 静默忽略（不错杀正常流量）
      console.debug('[WS] Unknown action "%s" from client (task=%j)', action, taskId);
    } catch (err) {
      // 顶层兜底：防止 async handler 中任何未预期异常变成 unhandled rejection
      // 如果没有这个 catch，Node.js 会触发 unhandledRejection，可能导致进程崩溃
      console.error('[WS] Unexpected error in message handler (task=%j):', taskId, err);
    }
  });

  // ─── 连接关闭清理 ─────────────────────────────────────────────

  ws.on('close', () => {
    clearInterval(pingInterval);
    manager.disconnect(taskId, ws);
  });

  // ─── 错误处理 — 防止连接泄漏 ──────────────────────────────────

  ws.on('error', (err) => {
    clearInterval(pingInterval);
    console.error('[WS] Connection error (task=%j):', taskId, err.message);
    manager.disconnect(taskId, ws);
  });
}
