import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { GameConfig } from './game/config';
import { useWebSocket, wsEventBus } from './hooks/useWebSocket';
import { SceneManager } from './game/SceneManager';
import { EventMapper } from './game/EventMapper';
import { AppProvider, useAppDispatch, useAppState } from './contexts/AppContext';
import { AppShell } from './components/layout/AppShell';
import { PetitionPanel } from './components/petition/PetitionPanel';
import { TaskList } from './components/petition/TaskList';
import { DebateLogPanel } from './components/debate/DebateLogPanel';

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
  const { isConnected, taskStatus } = useWebSocket(taskIdToUse);

  const sceneManagerRef = useRef<SceneManager | null>(null);
  const eventMapperRef = useRef<EventMapper | null>(null);

  useEffect(() => {
    dispatch({ type: 'SET_CONNECTION', isConnected });
  }, [isConnected, dispatch]);

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
      }
    });
    return () => sub.unsubscribe();
  }, [dispatch]);

  useEffect(() => {
    // Guard against stale state: only switch when taskStatus belongs to the currently active task
    if (taskStatus?.status && taskStatus.task_id === taskIdToUse) {
      sceneManagerRef.current?.switchTo(taskStatus.status, taskIdToUse);
    }
  }, [taskStatus, taskIdToUse]);

  return (
    <AppShell 
      leftPanel={
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <PetitionPanel />
          <TaskList />
        </div>
      }
      rightPanel={<DebateLogPanel />}
    >
      <div ref={gameRef} style={{ width: '100%', height: '100%' }} />
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
