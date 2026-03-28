import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DebateRound } from '../../contexts/AppContext';
import './Debate.css';

interface DebateRoundCardProps {
  round: DebateRound;
  defaultExpanded?: boolean;
}

/**
 * Typewriter hook — gradually reveals text at a fast pace.
 * Bulletproof implementation to prevent cursor getting stuck.
 */
function useTypewriter(fullText: string | undefined, enabled: boolean = true) {
  const [displayedLength, setDisplayedLength] = useState(() => {
    // If disabled or no text on first render, show everything immediately
    if (!enabled || !fullText) return fullText?.length ?? 0;
    return 0;
  });

  const effectiveLength = fullText?.length ?? 0;
  const isComplete = displayedLength >= effectiveLength;

  useEffect(() => {
    if (!fullText) {
      setDisplayedLength(0);
      return;
    }
    
    // Snap to complete instantly if we collapse/disable
    if (!enabled) {
      setDisplayedLength(fullText.length);
      return;
    }

    if (displayedLength >= fullText.length) {
      return;
    }

    const timer = setInterval(() => {
      setDisplayedLength((prev) => {
        const next = prev + 8; // 8 chars per ~15ms is extremely fast but visible
        if (next >= fullText.length) {
          clearInterval(timer);
          return fullText.length;
        }
        return next;
      });
    }, 15);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullText, enabled]); // Only re-run when actual text or visibility changes

  const displayedText = useMemo(() => {
    if (!fullText) return '';
    if (displayedLength >= fullText.length) return fullText;
    return fullText.substring(0, displayedLength);
  }, [fullText, displayedLength]);

  return { displayedText, isComplete };
}

export function DebateRoundCard({ round, defaultExpanded = true }: DebateRoundCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasContent = round.radical_statement || round.conservative_statement || round.speaker_intervention;

  const getConflictColor = (score: number) => {
    if (score > 80) return 'var(--color-accent-red)';
    if (score > 50) return 'var(--color-accent-yellow)';
    return 'inherit';
  };

  // Typewriter for each speaker — only active while the card is expanded
  const radical = useTypewriter(round.radical_statement, expanded);
  const conservative = useTypewriter(round.conservative_statement, expanded);
  const speaker = useTypewriter(round.speaker_intervention ?? undefined, expanded);

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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{radical.displayedText}</ReactMarkdown>
                  {!radical.isComplete && <span className="typewriter-cursor" />}
                </div>
              </div>
            )}

            {round.conservative_statement && (
              <div className="debate-bubble conservative">
                <div className="bubble-role">Conservative MP</div>
                <div className="bubble-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{conservative.displayedText}</ReactMarkdown>
                  {!conservative.isComplete && <span className="typewriter-cursor" />}
                </div>
              </div>
            )}

            {round.speaker_intervention && (
              <div className="debate-bubble speaker">
                <div className="bubble-role">
                  <span className="speaker-icon">⚖️</span> Speaker Order
                </div>
                <div className="bubble-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{speaker.displayedText}</ReactMarkdown>
                  {!speaker.isComplete && <span className="typewriter-cursor" />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
