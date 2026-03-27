import { useState, useEffect, useRef, useMemo } from 'react';
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
 * Targets ~1.5s total reveal time regardless of text length,
 * with a minimum of 5ms per chunk and a minimum chunk size of 3 chars.
 */
function useTypewriter(fullText: string | undefined, enabled: boolean = true) {
  const prevTextRef = useRef<string | undefined>(undefined);
  const [displayedLength, setDisplayedLength] = useState(() => {
    // If disabled or no text on first render, show everything immediately
    if (!enabled || !fullText) return fullText?.length ?? 0;
    return 0;
  });

  const effectiveLength = fullText?.length ?? 0;
  const isComplete = displayedLength >= effectiveLength;

  useEffect(() => {
    if (!fullText || !enabled) {
      // When disabled, we don't animate — parent reads displayedLength via useMemo
      prevTextRef.current = fullText;
      return;
    }

    // Determine start position: if new text extends old, type from the old end
    const prevText = prevTextRef.current;
    const startFrom = prevText && fullText.startsWith(prevText) ? prevText.length : 0;
    prevTextRef.current = fullText;

    if (startFrom >= fullText.length) return;

    const remaining = fullText.length - startFrom;
    const TARGET_DURATION_MS = 5000;
    const MIN_INTERVAL = 5;
    const chunkSize = Math.max(3, Math.ceil(remaining / (TARGET_DURATION_MS / MIN_INTERVAL)));
    const intervalMs = Math.max(MIN_INTERVAL, Math.floor(TARGET_DURATION_MS / Math.ceil(remaining / chunkSize)));

    let current = startFrom;
    // Use setTimeout(0) for the initial reset to avoid synchronous setState in effect body
    const initialTimer = setTimeout(() => {
      setDisplayedLength(startFrom);
    }, 0);

    const timer = setInterval(() => {
      current = Math.min(current + chunkSize, fullText.length);
      setDisplayedLength(current);
      if (current >= fullText.length) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [fullText, enabled]);

  const displayedText = useMemo(() => {
    if (!fullText) return '';
    if (!enabled) return fullText;
    if (displayedLength >= fullText.length) return fullText;
    return fullText.substring(0, displayedLength);
  }, [fullText, displayedLength, enabled]);

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
