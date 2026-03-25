import { useEffect, useRef, useState, useCallback } from 'react';
import { Subject } from 'rxjs';
import type { WSEventPayload, TaskStatusPayload } from '../types/backend';
import { useApi } from './useApi';

export const wsEventBus = new Subject<WSEventPayload>();

export function useWebSocket(taskId?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [taskStatus, setTaskStatus] = useState<TaskStatusPayload | null>(null);
  const { fetchTaskStatus } = useApi();

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!taskId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/task/${taskId}`;

    console.log(`[WS Client] Connecting to ${wsUrl}`);
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
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      if (ws !== wsRef.current) return;
      try {
        const payload = JSON.parse(event.data);
        console.log('[WS Client] Received:', payload);

        if (payload.action === 'status_update') {
          const wsData = payload.data as { task_id?: string; status: string; bill_state?: string };
          const effectiveStatus = wsData.bill_state ? wsData.bill_state : wsData.status;
          setTaskStatus({ task_id: wsData.task_id || taskId, status: effectiveStatus } as TaskStatusPayload);
        } else {
          wsEventBus.next(payload as WSEventPayload);
        }
      } catch (err) {
        console.error('[WS Client] Parse error', err);
      }
    };

    ws.onclose = () => {
      if (ws !== wsRef.current) return;
      console.log('[WS Client] Disconnected');
      setIsConnected(false);
      reconnectTimerRef.current = setTimeout(() => {
        if (ws === wsRef.current) connectRef.current?.();
      }, 3000);
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
    connect();

    return () => {
      setIsConnected(false);
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

  return { isConnected, taskStatus, sendCommand };
}
