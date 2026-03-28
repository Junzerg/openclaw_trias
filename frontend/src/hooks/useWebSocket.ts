import { useEffect, useRef, useState, useCallback } from 'react';
import { Subject } from 'rxjs';
import type { WSEventPayload, TaskStatusPayload } from '../types/backend';
import { useApi } from './useApi';

export const wsEventBus = new Subject<WSEventPayload>();

// ─── Task 4.8: 连接状态枚举 ────────────────────────────────────────
export type WsConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

// ─── Task 4.8: 指数退避参数 ────────────────────────────────────────
const BACKOFF_BASE_MS = 1000;   // 1s
const BACKOFF_CAP_MS = 30000;   // 30s
const BACKOFF_JITTER = 0.2;      // ±20%

/**
 * 计算指数退避延迟（含抖动）。
 * delay = min(base * 2^attempt, cap) * (1 + random(-jitter, +jitter))
 */
function getBackoffDelay(attempt: number): number {
  const raw = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS);
  const jitter = 1 + (Math.random() * 2 - 1) * BACKOFF_JITTER;
  return Math.round(raw * jitter);
}

export function useWebSocket(taskId?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<WsConnectionState>('offline');
  const [taskStatus, setTaskStatus] = useState<TaskStatusPayload | null>(null);
  const { fetchTaskStatus } = useApi();

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  // ─── Task 4.8: event_id 追踪 & 乱序重排 Buffer ──────────────────
  const lastEventIdRef = useRef<number>(0);
  const outOfOrderBufferRef = useRef<Map<number, any>>(new Map());
  const attemptRef = useRef<number>(0);

  const processPayload = useCallback((payload: any) => {
    if (payload.action === 'status_update') {
      const wsData = payload.data as { task_id?: string; status: string; bill_state?: string };
      const effectiveStatus = wsData.bill_state ? wsData.bill_state : wsData.status;
      setTaskStatus({ task_id: wsData.task_id || taskId, status: effectiveStatus } as TaskStatusPayload);
    } else {
      wsEventBus.next(payload as WSEventPayload);
    }
  }, [taskId]);

  const connect = useCallback(() => {
    if (!taskId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/task/${taskId}`;

    // 首次连接为 'connecting'，后续为 'reconnecting'
    const isReconnect = attemptRef.current > 0;
    setConnectionState(isReconnect ? 'reconnecting' : 'connecting');
    console.log(`[WS Client] ${isReconnect ? 'Reconnecting' : 'Connecting'} to ${wsUrl} (attempt ${attemptRef.current})`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws; // Capture identity for future checks

    fetchTaskStatus(taskId)
      .then(res => {
        if (ws === wsRef.current) {
          setTaskStatus({ task_id: taskId, status: res.bill_state } as TaskStatusPayload);
        }
      })
      .catch(err => console.error('[WS Client] Initial status fetch failed', err));

    ws.onopen = () => {
      if (ws !== wsRef.current) { ws.close(); return; }
      console.log('[WS Client] Connected');
      setConnectionState('connected');
      attemptRef.current = 0; // 重置重试计数

      // ─── Task 4.8: 重连后立即请求 Replay 补发遗漏事件 ──────────
      if (lastEventIdRef.current > 0) {
        console.log('[WS Client] Requesting replay after event_id=%d', lastEventIdRef.current);
        ws.send(JSON.stringify({
          action: 'replay',
          data: { after_event_id: lastEventIdRef.current },
        }));
      }
    };

    ws.onmessage = (event) => {
      if (ws !== wsRef.current) return;
      try {
        const payload = JSON.parse(event.data);
        console.log('[WS Client] Received:', payload);

        // ─── Task 4.8: 更新 event_id 追踪 & 乱序重排验证 ──────────
        if (typeof payload.event_id === 'number') {
          if (lastEventIdRef.current === 0) {
            // Initial payload connection baseline
            lastEventIdRef.current = payload.event_id;
            processPayload(payload);
          } else {
            const expectedId = lastEventIdRef.current + 1;

            if (payload.event_id <= lastEventIdRef.current) {
              // Deduplication (At-Least-Once Delivery safety)
              console.debug(`[WS Client] Dropping duplicate event_id=${payload.event_id}`);
              return;
            }

            if (payload.event_id > expectedId) {
              // Out-of-order execution (Gap detected), Buffer it!
              console.debug(`[WS Client] Buffering out-of-order event_id=${payload.event_id} (expected ${expectedId})`);
              outOfOrderBufferRef.current.set(payload.event_id, payload);
              return;
            }

            // In-order event match
            lastEventIdRef.current = payload.event_id;
            processPayload(payload);

            // Drain buffer for contiguous future events
            let nextExpected = lastEventIdRef.current + 1;
            while (outOfOrderBufferRef.current.has(nextExpected)) {
              const bufferedPayload = outOfOrderBufferRef.current.get(nextExpected);
              outOfOrderBufferRef.current.delete(nextExpected);
              
              console.debug(`[WS Client] Draining buffered event_id=${nextExpected}`);
              lastEventIdRef.current = nextExpected;
              processPayload(bufferedPayload);
              nextExpected++;
            }
          }
        } else {
          // Fallback for events without event_id
          processPayload(payload);
        }
      } catch (err) {
        console.error('[WS Client] Parse error', err);
      }
    };

    ws.onclose = () => {
      if (ws !== wsRef.current) return;
      console.log('[WS Client] Disconnected');
      setConnectionState('reconnecting');

      // ─── Task 4.8: 指数退避重连 ───────────────────────────────
      const delay = getBackoffDelay(attemptRef.current);
      attemptRef.current += 1;
      console.log('[WS Client] Reconnecting in %dms (attempt %d)', delay, attemptRef.current);

      reconnectTimerRef.current = setTimeout(() => {
        if (ws === wsRef.current) connectRef.current?.();
      }, delay);
    };

    ws.onerror = () => {
      if (ws !== wsRef.current) return;
      console.warn('[WS Client] Connection error, will retry...');
      ws.close();
    };
  }, [taskId, fetchTaskStatus]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    // 新的 taskId 时重置 event_id 追踪
    lastEventIdRef.current = 0;
    attemptRef.current = 0;
    outOfOrderBufferRef.current.clear();

    connect();

    return () => {
      setConnectionState('offline');
      setTaskStatus(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendCommand = (action: string, data?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, data }));
    } else {
      console.warn('[WS Client] Cannot send, not connected');
    }
  };

  // 向后兼容：isConnected 保留为派生 boolean
  const isConnected = connectionState === 'connected';

  return { isConnected, connectionState, taskStatus, sendCommand };
}
