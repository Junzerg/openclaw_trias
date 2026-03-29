import { useState, useEffect, useMemo, useRef } from 'react';
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
 * Streaming-aware: when text grows incrementally (e.g. from STREAM_CHUNK),
 * instead of snapping, it continues revealing tokens character by character.
 */
function useTypewriter(fullText: string | undefined, enabled: boolean = true) {
  const [displayedLength, setDisplayedLength] = useState(() => {
    if (!enabled || !fullText) return fullText?.length ?? 0;
    return 0;
  });
  const fullTextRef = useRef(fullText);
  useEffect(() => {
    fullTextRef.current = fullText;
  }, [fullText]);

  useEffect(() => {
    if (!enabled) {
      if (fullTextRef.current) setDisplayedLength(fullTextRef.current.length);
      return;
    }

    const timer = setInterval(() => {
      setDisplayedLength((prev) => {
        const targetText = fullTextRef.current;
        if (!targetText) return 0;
        
        if (prev >= targetText.length) {
          return prev;
        }
        
        const gap = targetText.length - prev;
        // Dynamic speed based on gap, but rigidly capped to simulate streaming
        // 3 chars/tick @ 40fps = 120 chars/sec
        const charsPerTick = gap > 100 ? 3 : (gap > 20 ? 2 : 1);
        return Math.min(prev + charsPerTick, targetText.length);
      });
    }, 25);

    return () => clearInterval(timer);
  }, [enabled]);

  const displayedText = useMemo(() => {
    if (!fullText) return '';
    if (displayedLength >= fullText.length) return fullText;
    return fullText.substring(0, displayedLength);
  }, [fullText, displayedLength]);

  const effectiveLength = fullText?.length ?? 0;
  const isComplete = displayedLength >= effectiveLength;

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
