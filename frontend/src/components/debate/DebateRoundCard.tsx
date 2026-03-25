import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { DebateRound } from '../../contexts/AppContext';
import './Debate.css';

interface DebateRoundCardProps {
  round: DebateRound;
  defaultExpanded?: boolean;
}

export function DebateRoundCard({ round, defaultExpanded = true }: DebateRoundCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // A helper to determine if we should even show the card body
  const hasContent = round.radical_statement || round.conservative_statement || round.speaker_intervention;

  // Determine indicator color based on conflict score severity
  const getConflictColor = (score: number) => {
    if (score > 80) return 'var(--color-accent-red)';
    if (score > 50) return 'var(--color-accent-yellow)';
    return 'inherit';
  };

  return (
    <div className={`debate-round-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="round-header" onClick={() => setExpanded(!expanded)}>
        <span>Round {round.round_number}</span>
        <span className="round-header-conflict" style={{ color: getConflictColor(round.conflict_score) }}>
          [{expanded ? '−' : '+'}] Conflict: {round.conflict_score.toFixed(1)}
        </span>
      </div>

      {hasContent && (
        <div className={`round-content ${expanded ? 'expanded' : 'collapsed'}`}>
          <div>
            {round.radical_statement && (
              <div className="debate-bubble radical">
                <div className="bubble-role">Radical MP</div>
                <div className="bubble-text">
                  <ReactMarkdown>{round.radical_statement}</ReactMarkdown>
                </div>
              </div>
            )}

            {round.conservative_statement && (
              <div className="debate-bubble conservative">
                <div className="bubble-role">Conservative MP</div>
                <div className="bubble-text">
                  <ReactMarkdown>{round.conservative_statement}</ReactMarkdown>
                </div>
              </div>
            )}

            {round.speaker_intervention && (
              <div className="debate-bubble speaker">
                <div className="bubble-role">
                  <span className="speaker-icon">⚖️</span> Speaker Order
                </div>
                <div className="bubble-text">
                  <ReactMarkdown>{round.speaker_intervention}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
