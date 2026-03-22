import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameConfig } from './game/config';
import { useWebSocket, wsEventBus } from './hooks/useWebSocket';
import { SceneManager } from './game/SceneManager';
import { EventMapper } from './game/EventMapper';
import './App.css';

function App() {
  const gameRef = useRef<HTMLDivElement>(null);
  const gameInstance = useRef<Phaser.Game | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const taskId = searchParams.get('taskId') || 'f3dd156f-21f4-4df8-afc7-53cbb6d4bb5d';
  const { isConnected, taskStatus, sendCommand } = useWebSocket(taskId);
  const [inputValue, setInputValue] = useState('');

  const sceneManagerRef = useRef<SceneManager | null>(null);
  const eventMapperRef = useRef<EventMapper | null>(null);

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
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (taskStatus?.status) {
      sceneManagerRef.current?.switchTo(taskStatus.status);
    }
  }, [taskStatus?.status]);

  return (
    <div className="flex flex-col h-screen overflow-hidden box-border py-4">
      <div className="text-center shrink-0">
        <h1 className="text-2xl font-bold m-0">OpenClaw Cyber Trias</h1>
        <p className="my-2 text-lg">
          State: <span style={{ color: isConnected ? "lightgreen" : "red" }}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span> | Task: {taskStatus ? taskStatus.status : 'Loading...'}
        </p>
        <p className="mb-4 text-lg">
          Press <b>SPACE</b> to trigger the Speaker's hammer animation.
        </p>
      </div>
      
      <div className="grow min-h-0 flex items-center justify-center p-2 rounded-lg mx-4 overflow-hidden">
        <div ref={gameRef} className="w-full h-full flex items-center justify-center" />
      </div>
      
      <div className="mt-4 flex gap-2 justify-center shrink-0 w-full px-4 max-w-4xl mx-auto">
        <input 
          type="text" 
          className="flex-1 px-4 py-2 text-lg rounded border border-gray-600 bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          placeholder="输入您的自然语言指令 (发送给后端)..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && inputValue) {
              sendCommand('new_task', { prompt: inputValue });
              setInputValue('');
            }
          }}
        />
        <button 
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-lg transition-colors cursor-pointer border-0"
          onClick={() => {
            if (inputValue) {
              sendCommand('new_task', { prompt: inputValue });
              setInputValue('');
            }
          }}
        >
          Send
        </button>
      </div>
      
      <div className="mt-4 flex flex-wrap gap-2 justify-center shrink-0">
        <button 
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => sendCommand('debug_brawl', { intensity: 10 })}
        >
          Trigger Brawl (Debug)
        </button>
        <button 
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => {
            import('./hooks/useWebSocket').then(m => {
              m.wsEventBus.next({ action: 'propose', source_agent: 'radical_mp', statement: '我们必须通过这个法案！' } as any);
            });
          }}
        >
          Trigger Propose (Local)
        </button>
        <button 
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => {
            import('./hooks/useWebSocket').then(m => {
              m.wsEventBus.next({ action: 'debate', source_agent: 'conservative_mp', statement: '这绝对是无稽之谈。' } as any);
            });
          }}
        >
          Trigger Debate (Local)
        </button>
        <button 
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => {
            import('./hooks/useWebSocket').then(m => {
              m.wsEventBus.next({ action: 'order', source_agent: 'speaker', intensity: 1 } as any);
            });
          }}
        >
          Trigger Order (Local)
        </button>
        <button 
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => {
            import('./hooks/useWebSocket').then(m => {
              m.wsEventBus.next({ action: 'vote_passed', source_agent: 'speaker', ayes: 5, nays: 0, result: 'passed' } as any);
            });
          }}
        >
          Trigger Vote Passed (Local)
        </button>
        <button 
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors font-medium border-0 cursor-pointer"
          onClick={() => sendCommand('debug_sign', { act_name: 'Cyber Act 101' })}
        >
          Trigger Sign (Debug)
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 justify-center shrink-0">
        <button 
          className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded font-bold border border-gray-600 cursor-pointer"
          onClick={() => sceneManagerRef.current?.switchTo('Executing')}
        >
          [Scene: Executive]
        </button>
        <button 
          className="px-3 py-1 bg-blue-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'sign', data: { act_name: 'AI Act' } } as any))}
        >
          Sign
        </button>
        <button 
          className="px-3 py-1 bg-blue-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'veto' } as any))}
        >
          Veto
        </button>
        <button 
          className="px-3 py-1 bg-blue-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'tool_call', data: { logs: 'Running linter...\nChecking types...\nSuccess' } } as any))}
        >
          Tool Call
        </button>
        <button 
          className="px-3 py-1 bg-blue-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'error' } as any))}
        >
          Error
        </button>

        <span className="text-gray-400 mx-2">|</span>

        <button 
          className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded font-bold border border-gray-600 cursor-pointer"
          onClick={() => sceneManagerRef.current?.switchTo('Reviewing')}
        >
          [Scene: Judicial]
        </button>
        <button 
          className="px-3 py-1 bg-green-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'constitutional' } as any))}
        >
          Constitutional
        </button>
        <button 
          className="px-3 py-1 bg-red-600 text-white rounded border-0 cursor-pointer"
          onClick={() => import('./hooks/useWebSocket').then(m => m.wsEventBus.next({ action: 'unconstitutional' } as any))}
        >
          Unconstitutional
        </button>
      </div>
    </div>
  );
}

export default App;
