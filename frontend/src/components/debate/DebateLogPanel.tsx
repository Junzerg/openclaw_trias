import { useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../../contexts/AppContext';
import { useApi } from '../../hooks/useApi';
import { DebateRoundCard } from './DebateRoundCard';
import { ConflictScoreChart } from './ConflictScoreChart';
import './Debate.css';

export function DebateLogPanel() {
  const { debate, activeTaskId } = useAppState();
  const dispatch = useAppDispatch();
  const { fetchDebate } = useApi();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load history on mount or task change
  useEffect(() => {
    if (activeTaskId) {
      fetchDebate(activeTaskId)
        .then((res) => {
          dispatch({
            type: 'DEBATE_LOAD_HISTORY',
            rounds: res.rounds,
            conflictScores: res.conflict_score_curve || [],
          });
        })
        .catch(console.error);
    }
  }, [activeTaskId, fetchDebate, dispatch]);

  // Auto-scroll to bottom when new rounds/content arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [debate.rounds, debate.rounds.length, debate.currentRound]);

  if (!activeTaskId) {
    return (
      <div className="debate-log-panel">
        <div className="debate-empty-state">
          <div>No active task selected</div>
        </div>
      </div>
    );
  }

  if (debate.rounds.length === 0) {
    return (
      <div className="debate-log-panel">
        <ConflictScoreChart />
        <div className="debate-empty-state">
          <div className="status-dot" style={{ backgroundColor: 'var(--color-accent-blue)', marginBottom: 'var(--spacing-md)' }} />
          <div>Waiting for debate to begin...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="debate-log-panel">
      <ConflictScoreChart />
      
      {debate.rounds.map((round) => (
        <DebateRoundCard 
          key={`round-${round.round_number}`} 
          round={round} 
          defaultExpanded={true} 
        />
      ))}
      
      {debate.thinkingAgent && (
        <div className="debate-round-card expanded" style={{ border: '1px dashed rgba(255,255,255,0.2)', opacity: 0.8 }}>
          <div className="round-content expanded">
            <div>
              <div className={`debate-bubble ${debate.thinkingAgent.role.includes('radical') ? 'radical' : 'conservative'} thinking-bubble`}>
                <div className="bubble-role">{debate.thinkingAgent.role.replace('_', ' ').toUpperCase()}</div>
                <div className="bubble-text" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
                  <span>Synthesizing argument<span className="dot-pulse">...</span></span>
                  <span style={{ marginLeft: '12px', opacity: 0.5, fontSize: '0.85em', fontFamily: 'var(--font-mono)' }}>
                    [{debate.thinkingAgent.elapsed}s]
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Anchor for auto-scrolling */}
      <div ref={bottomRef} style={{ height: '1px', opacity: 0 }} />
    </div>
  );
}
