import { useEffect, useRef, useState, useCallback } from 'react';
import { Subject } from 'rxjs';
import type { WSEventPayload, TaskStatusPayload } from '../types/backend';

export const wsEventBus = new Subject<WSEventPayload>();

export function useWebSocket(taskId?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [taskStatus, setTaskStatus] = useState<TaskStatusPayload | null>(null);

  // Guard against React StrictMode double-mount: the first mount's WebSocket
  // gets torn down immediately, which fires onerror/onclose before connection
  // is established. This flag suppresses those spurious errors.
  const isCleanedUpRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!taskId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/task/${taskId}`;

    console.log(`[WS Client] Connecting to ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (isCleanedUpRef.current) { ws.close(); return; }
      console.log('[WS Client] Connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      if (isCleanedUpRef.current) return;
      try {
        const payload = JSON.parse(event.data);
        console.log('[WS Client] Received:', payload);

        if (payload.action === 'status_update') {
          setTaskStatus(payload.data as TaskStatusPayload);
        } else {
          wsEventBus.next(payload as WSEventPayload);
        }
      } catch (err) {
        console.error('[WS Client] Parse error', err);
      }
    };

    ws.onclose = () => {
      if (isCleanedUpRef.current) return;
      console.log('[WS Client] Disconnected');
      setIsConnected(false);
      // Automatically reconnect after a delay
      reconnectTimerRef.current = setTimeout(() => {
        if (!isCleanedUpRef.current) connectRef.current?.();
      }, 3000);
    };

    ws.onerror = () => {
      if (isCleanedUpRef.current) return;
      console.warn('[WS Client] Connection error, will retry...');
      ws.close();
    };

    wsRef.current = ws;
  }, [taskId]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    isCleanedUpRef.current = false;
    connect();

    return () => {
      isCleanedUpRef.current = true;
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
