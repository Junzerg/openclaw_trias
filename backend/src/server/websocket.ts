/**
 * WebSocket 端点处理 — 翻译自 Python websocket.py。
 *
 * 处理 /ws/task/:id 的 WebSocket 连接上的客户端消息：
 * - ping 心跳 → pong 响应
 * - new_task 控制指令 → 触发新 Pipeline
 * - debug_* 调试指令 → 广播模拟事件
 */

import type { WebSocket } from 'ws';
import { TaskStatus, type AppState, type IConnectionManager } from './app';
import { PetitionRequestSchema } from './schemas'; // 引入 Schema 用于防绕过验证
import { runPetition } from './pipeline-bridge';

/**
 * 处理一个已建立的 WebSocket 连接。
 *
 * 由 upgrade 处理器在握手完成后调用，注册消息监听和清理逻辑。
 */
export function handleWebSocketConnection(
  ws: WebSocket,
  taskId: string,
  manager: IConnectionManager,
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

        // Bug 53 fix: Prevent task hijacking. If task already exists, reject.
        const existing = await appState.taskStore.getTask(taskId);
        if (existing) {
          ws.send(JSON.stringify({
            action: 'error',
            data: { message: `Task ${taskId} already exists. task_id must be unique for new_task.` },
            task_id: taskId,
          }));
          return;
        }

        // 防雷 11 (Phase 9): TOCTOU 并发注入保护
        // 如果两个恶意连接在同一毫秒内发送相同 task_id，它们会同时通过上面的现有检查，
        // 从而在此刻同时触碰 DB。必须用 try-catch 拦截 UNIQUE constraint failed。
        try {
          await appState.taskStore.createTask(taskId, prompt);
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
            ws.send(JSON.stringify({
              action: 'error',
              data: { message: `Task ${taskId} was just created by another concurrent request.` },
              task_id: taskId,
            }));
            return;
          }
          throw err;
        }

        // 防雷 12 (Phase 9): 防止 UI 永久挂起死锁
        // 必须先提交队列成功，然后再给前端广播 task_started。
        // 否则如果队列抛出异常（如队列阻塞、规则拒绝），前端拿到 started 后会永久假死 (无限 spinning)。
        try {
          await appState.taskQueue.submit(taskId, async () => {
            await runPetition(taskId, prompt, appState);
          });
          
          ws.send(JSON.stringify({
            action: 'task_started',
            task_id: taskId
          }));
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({
            action: 'error',
            data: { message: errorMessage || 'Failed to submit task to queue.' },
            task_id: taskId,
          }));
          
          // 如果写入数据库成功但队列拒绝，任务在 DB 里会永久卡在 PENDING。
          // 必须主动将其标记为 FAILED 防止悬空态。
          try {
            await appState.taskStore.updateTask(taskId, {
              status: TaskStatus.FAILED,
              result: errorMessage || 'Submit failed',
            });
          } catch (dbErr) {
            console.error('[WS] Failed to cleanup pending task after queue rejection:', dbErr);
          }
          return;
        }
        return;
      }

      // ─── Task 4.8: replay 断线重连事件补发 ─────────────────────────
      if (action === 'replay') {
        try {
          const replayData = payload.data;
          if (
            !replayData ||
            typeof replayData !== 'object' ||
            Array.isArray(replayData)
          ) {
            console.debug('[WS] replay: invalid data format (task=%j)', taskId);
            return;
          }

          const afterEventId = (replayData as Record<string, unknown>).after_event_id;
          if (typeof afterEventId !== 'number' || !Number.isFinite(afterEventId)) {
            console.debug('[WS] replay: invalid after_event_id (task=%j): %j', taskId, afterEventId);
            return;
          }

          const missedEvents = manager.getEventsAfter(taskId, afterEventId);
          console.log(
            '[WS] Replay requested (task=%j): after_event_id=%d, replaying %d events',
            taskId,
            afterEventId,
            missedEvents.length,
          );

          // 逐条发送给请求的 client（不是广播！），Fire and Forget 防阻塞
          for (const event of missedEvents) {
            if (ws.readyState !== ws.OPEN) break; // 中途断开则立即停止

            ws.send(JSON.stringify(event.payload), (err) => {
              if (err) {
                console.debug('[WS] Replay send failed (task=%j): %s', taskId, err.message);
              }
            });
          }
        } catch (err) {
          console.error('[WS] Replay handler error (task=%j):', taskId, err);
        }
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
