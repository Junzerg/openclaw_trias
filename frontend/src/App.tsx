import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameConfig } from './game/config';
import { useWebSocket, wsEventBus, streamChunkBus } from './hooks/useWebSocket';
import { SceneManager } from './game/SceneManager';
import { EventMapper } from './game/EventMapper';
import { AppProvider, useAppDispatch, useAppState } from './contexts/AppContext';
import { AppShell } from './components/layout/AppShell';
import { PetitionPanel } from './components/petition/PetitionPanel';
import { TaskList } from './components/petition/TaskList';
import { DebateLogPanel } from './components/debate/DebateLogPanel';
import { ResultPanel } from './components/result/ResultPanel';
import { TokenDashboard } from './components/metrics/TokenDashboard';
import { ConflictScoreChart } from './components/debate/ConflictScoreChart';
import { SoulEditor } from './components/config/SoulEditor';

import './styles/design-system.css';
import './App.css';

function AppContent() {
  const gameRef = useRef<HTMLDivElement>(null);
  const gameInstance = useRef<Phaser.Game | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const initialTaskId = searchParams.get('taskId') || 'f3dd156f-21f4-4df8-afc7-53cbb6d4bb5d';
  
  const { activeTaskId } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!activeTaskId) {
      dispatch({ type: 'SET_ACTIVE_TASK', taskId: initialTaskId });
    } else if (activeTaskId !== initialTaskId) {
      // Keep URL perfectly in sync silently
      const url = new URL(window.location.href);
      url.searchParams.set('taskId', activeTaskId);
      window.history.replaceState({}, '', url.toString());
    }
  }, [activeTaskId, initialTaskId, dispatch]);

  const taskIdToUse = activeTaskId || initialTaskId;
  const { isConnected, connectionState, taskStatus } = useWebSocket(taskIdToUse);

  const [viewMode, setViewMode] = useState<'debate' | 'config'>('debate');

  const sceneManagerRef = useRef<SceneManager | null>(null);
  const eventMapperRef = useRef<EventMapper | null>(null);

  useEffect(() => {
    dispatch({ type: 'SET_CONNECTION', isConnected });
    dispatch({ type: 'SET_WS_STATE', wsState: connectionState });
  }, [isConnected, connectionState, dispatch]);

  useEffect(() => {
    if (gameRef.current && !gameInstance.current) {
      gameInstance.current = new Phaser.Game({
        ...GameConfig,
        parent: gameRef.current,
      });
      sceneManagerRef.current = new SceneManager(gameInstance.current);
      eventMapperRef.current = new EventMapper(sceneManagerRef.current);
    }

    return () => {
      if (gameInstance.current) {
        gameInstance.current.destroy(true);
        gameInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const sub = wsEventBus.subscribe((event) => {
      eventMapperRef.current?.handleEvent(event);
      if (['propose', 'debate', 'brawl', 'order'].includes(event.action)) {
        dispatch({ type: 'DEBATE_EVENT', event });
      } else if (event.action === 'llm_thinking') {
        dispatch({ type: 'THINKING_EVENT', event });
      } else if (event.action === 'token_usage') {
        dispatch({ type: 'TOKEN_USAGE', event });
      }
    });
    return () => sub.unsubscribe();
  }, [dispatch]);

  // Subscribe to stream chunks for real-time debate panel updates
  // Throttle dispatches to ~300ms to avoid excessive React re-renders from high-frequency token events
  useEffect(() => {
    let pendingChunks: Record<string, string> = {};
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const flush = () => {
      for (const [agent, chunk] of Object.entries(pendingChunks)) {
        if (chunk) {
          dispatch({ type: 'STREAM_CHUNK', agent, chunk, completed: false });
        }
      }
      pendingChunks = {};
    };

    const sub = streamChunkBus.subscribe((event) => {
      if (event.completed) {
        flush(); // flush any remaining before signaling completion
        dispatch({ type: 'STREAM_CHUNK', agent: event.agent, chunk: '', completed: true });
        return;
      }
      pendingChunks[event.agent] = (pendingChunks[event.agent] || '') + event.chunk;

      if (!flushTimer) {
        flushTimer = setInterval(() => {
          flush();
          if (Object.keys(pendingChunks).length === 0 && flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
          }
        }, 300);
      }
    });

    return () => {
      sub.unsubscribe();
      if (flushTimer) clearInterval(flushTimer);
    };
  }, [dispatch]);

  useEffect(() => {
    // Guard against stale state: only switch when taskStatus belongs to the currently active task
    if (taskStatus?.status && taskStatus.task_id === taskIdToUse) {
      sceneManagerRef.current?.switchTo(taskStatus.status, taskIdToUse);
    }
  }, [taskStatus, taskIdToUse]);

  const statusStr = (taskStatus?.status as string | undefined)?.toUpperCase();
  const isResultPhase = statusStr === 'CONSTITUTIONAL' || 
                        statusStr === 'UNCONSTITUTIONAL' || 
                        statusStr === 'DELIVERED' ||
                        statusStr === 'FAILED';

  return (
    <AppShell 
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      leftPanel={
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
          <PetitionPanel />
          <TaskList />
        </div>
      }
      rightPanel={
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
          <ConflictScoreChart />
          <div style={{ marginTop: 'var(--spacing-md)' }}>
            <TokenDashboard />
          </div>
        </div>
      }
      bottomPanel={isResultPhase ? <ResultPanel /> : <DebateLogPanel />}
    >
      {viewMode === 'config' ? (
        <SoulEditor />
      ) : (
        <div ref={gameRef} style={{ width: '100%', height: '100%' }} />
      )}
    </AppShell>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
