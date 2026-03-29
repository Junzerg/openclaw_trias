import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebSocketConnection } from '../../src/server/websocket';
import { TaskStatus, type AppState, type IConnectionManager, type ITaskQueue } from '../../src/server/app';

interface MockWebSocket {
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  readyState: number;
  OPEN: number;
}

function createMockWebSocket(): MockWebSocket {
  return {
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    readyState: 1, // OPEN
    OPEN: 1,
  };
}

describe('Phase 9 Deep Audit — WebSocket Concurrency', () => {
  let ws1: MockWebSocket;
  let ws2: MockWebSocket;
  let cm: IConnectionManager;
  let state: AppState;

  beforeEach(() => {
    ws1 = createMockWebSocket();
    ws2 = createMockWebSocket();
    cm = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      getConnectionCount: vi.fn(),
      closeAll: vi.fn()
    };
    state = {
      government: {} as any,
      wsManager: cm,
      taskStore: {
        getTask: vi.fn().mockResolvedValue(null),
        createTask: vi.fn().mockResolvedValue(undefined),
        updateTask: vi.fn().mockResolvedValue(undefined),
      } as any,
      taskQueue: {
        submit: vi.fn().mockResolvedValue(undefined),
      } as unknown as ITaskQueue,
    };
  });

  it('Bug [Phase 9]: TOCTOU taskId collision is caught and handled via UNIQUE constraint', async () => {
    handleWebSocketConnection(ws1 as any, 'task-toctou', cm, state);

    // Get the message handler
    const messageHandler = ws1.on.mock.calls.find(c => c[0] === 'message')[1];

    const payload = JSON.stringify({
      action: 'new_task',
      data: { prompt: 'do something' },
    });

    // Simulate TOCTOU: createTask fails on the second call with SQLite unique constraint
    let createCount = 0;
    (state.taskStore.createTask as any).mockImplementation(async () => {
      createCount++;
      if (createCount === 2) {
        throw new Error('UNIQUE constraint failed: tasks.id');
      }
    });

    // Run two handlers concurrently
    await Promise.all([
      messageHandler(payload),
      messageHandler(payload)
    ]);

    // One succeeds, one should have caught the UNIQUE constraint and sent an error
    const sendCalls = ws1.send.mock.calls;
    
    // We expect one task_started and one error response
    const hasTaskStarted = sendCalls.some(c => JSON.parse(c[0]).action === 'task_started');
    const hasError = sendCalls.some(c => JSON.parse(c[0]).action === 'error' && JSON.parse(c[0]).data.message.includes('concurrent request'));

    expect(hasTaskStarted).toBe(true);
    expect(hasError).toBe(true);
  });

  it('Bug [Phase 9]: Premature task_started UI hang avoided when queue submission fails', async () => {
    handleWebSocketConnection(ws1 as any, 'task-deadlock', cm, state);
    const messageHandler = ws1.on.mock.calls.find(c => c[0] === 'message')[1];

    const payload = JSON.stringify({
      action: 'new_task',
      data: { prompt: 'do something' },
    });

    // Simulate taskQueue.submit throwing synchronously
    (state.taskQueue.submit as any).mockRejectedValue(new Error('Queue is permanently full'));

    await messageHandler(payload);

    const sendCalls = ws1.send.mock.calls;
    
    // We expect NO task_started
    const hasTaskStarted = sendCalls.some(c => JSON.parse(c[0]).action === 'task_started');
    // We expect ONE error response
    const hasError = sendCalls.some(c => JSON.parse(c[0]).action === 'error' && JSON.parse(c[0]).data.message.includes('Queue is permanently full'));

    expect(hasTaskStarted).toBe(false);
    expect(hasError).toBe(true);

    // We also expect DB updateTask to be called to mark it as FAILED
    expect(state.taskStore.updateTask).toHaveBeenCalledWith(
      'task-deadlock',
      { status: TaskStatus.FAILED, result: 'Queue is permanently full' }
    );
  });
});
