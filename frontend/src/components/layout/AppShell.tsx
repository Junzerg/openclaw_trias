import React, { useState } from 'react';
import { useAppState } from '../../contexts/AppContext';
import '../../styles/design-system.css';

interface AppShellProps {
  children: React.ReactNode; // Center canvas goes here
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
}

export function AppShell({ children, leftPanel, rightPanel }: AppShellProps) {
  const { connection } = useAppState();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="header-title">
          <h1>OpenClaw Cyber Trias</h1>
        </div>
        <div className="header-status">
          <span className="status-indicator">
            <span 
              className="status-dot" 
              style={{ backgroundColor: connection.isConnected ? 'var(--color-accent-green)' : 'var(--color-accent-red)' }}
            />
            {connection.isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
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

        {/* Center Canvas */}
        <section className="canvas-container">
          {children}
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
      </main>

      {/* Footer (Optional) */}
      {/* <footer className="app-footer">Status Bar</footer> */}
    </div>
  );
}
