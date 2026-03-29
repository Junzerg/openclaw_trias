import React, { useState } from 'react';
import { useAppState } from '../../contexts/AppContext';
import '../../styles/design-system.css';

interface AppShellProps {
  children: React.ReactNode; // Center canvas goes here
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel?: React.ReactNode;
  viewMode?: 'debate' | 'config';
  onViewModeChange?: (mode: 'debate' | 'config') => void;
}

export function AppShell({ children, leftPanel, rightPanel, bottomPanel, viewMode = 'debate', onViewModeChange }: AppShellProps) {
  const { connection } = useAppState();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const isConfig = viewMode === 'config';

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="header-title">
          <h1>OpenClaw Cyber Trias</h1>
        </div>
        <div className="header-nav">
          <button 
            className={`header-tab ${!isConfig ? 'active' : ''}`}
            onClick={() => onViewModeChange?.('debate')}
          >
            🏛️ 辩论
          </button>
          <button 
            className={`header-tab ${isConfig ? 'active' : ''}`}
            onClick={() => onViewModeChange?.('config')}
          >
            ⚙️ 配置
          </button>
        </div>
        <div className="header-status">
          <span className="status-indicator">
            <span 
              className={`status-dot${connection.wsState === 'reconnecting' ? ' pulse' : ''}`}
              style={{ backgroundColor: 
                connection.wsState === 'connected' ? 'var(--color-accent-green)' :
                connection.wsState === 'connecting' || connection.wsState === 'reconnecting' ? 'var(--color-accent-yellow)' :
                'var(--color-accent-red)'
              }}
            />
            {connection.wsState === 'connected' ? 'Connected' :
             connection.wsState === 'connecting' ? 'Connecting…' :
             connection.wsState === 'reconnecting' ? 'Reconnecting…' :
             'Offline'}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {isConfig ? (
          /* Config mode: full-width editor */
          <section className="center-column" style={{ width: '100%' }}>
            {children}
          </section>
        ) : (
          <>
            {/* Left Panel */}
            <aside className={`panel panel-left ${leftOpen ? 'open' : 'closed'}`}>
              <button 
                className="panel-toggle toggle-left" 
                onClick={() => setLeftOpen(!leftOpen)}
                title="Toggle Left Panel"
              >
                {leftOpen ? '◀' : '▶'}
              </button>
              <div className="panel-inner">
                <div className="panel-content">
                  {leftPanel || <div className="panel-placeholder">Left Panel Slot</div>}
                </div>
              </div>
            </aside>

            {/* Center Column */}
            <section className="center-column">
              {/* Top Canvas */}
              <div className="canvas-container">
                {children}
              </div>
              
              {/* Bottom Panel */}
              {bottomPanel && (
                <div className="bottom-panel">
                  <div className="panel-inner">
                    <div className="panel-content">
                      {bottomPanel}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Right Panel */}
            <aside className={`panel panel-right ${rightOpen ? 'open' : 'closed'}`}>
              <button 
                className="panel-toggle toggle-right" 
                onClick={() => setRightOpen(!rightOpen)}
                title="Toggle Right Panel"
              >
                {rightOpen ? '▶' : '◀'}
              </button>
              <div className="panel-inner">
                <div className="panel-content">
                  {rightPanel || <div className="panel-placeholder">Right Panel Slot</div>}
                </div>
              </div>
            </aside>
          </>
        )}
      </main>

      {/* Footer (Optional) */}
      {/* <footer className="app-footer">Status Bar</footer> */}
    </div>
  );
}
