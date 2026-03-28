import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAppState, useAppDispatch } from '../../contexts/AppContext';
import { useApi } from '../../hooks/useApi';
import { VerdictBanner } from './VerdictBanner';
import './Result.css';

export const ResultPanel: React.FC = () => {
  const { activeTaskId, act, result, verdict } = useAppState();
  const dispatch = useAppDispatch();
  const { fetchAct, fetchVerdict, fetchTaskStatus } = useApi();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeTaskId) return;

    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      try {
        const [actRes, verdictRes, statusRes] = await Promise.all([
          fetchAct(activeTaskId).catch(err => {
            console.warn('Failed to fetch act:', err);
            return null;
          }),
          fetchVerdict(activeTaskId).catch(err => {
            console.warn('Failed to fetch verdict:', err);
            return null;
          }),
          fetchTaskStatus(activeTaskId).catch(err => {
            console.warn('Failed to fetch task status:', err);
            return null;
          })
        ]);

        if (!mounted) return;
        if (actRes && actRes.act) {
          dispatch({ type: 'ACT_LOADED', act: actRes.act });
        }
        if (statusRes && statusRes.result) {
          dispatch({ type: 'RESULT_LOADED', result: statusRes.result });
        }
        if (verdictRes) {
          dispatch({
            type: 'VERDICT_LOADED',
            verdict: {
              ruling: verdictRes.ruling,
              constitutional: verdictRes.constitutional,
              evidence: verdictRes.evidence || []
            }
          });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [activeTaskId, fetchAct, fetchVerdict, fetchTaskStatus, dispatch]);

  const renderActValue = (key: string, value: unknown) => {
    const isError = key.toLowerCase().includes('error') || key.toLowerCase().includes('stderr');

    if (typeof value === 'string') {
      return (
        <div className={`act-item ${isError ? 'is-error' : ''}`} key={key}>
          <div className="act-item-key">{key}</div>
          <div className="act-item-value">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        </div>
      );
    }
    
    if (value !== null && typeof value === 'object') {
      return (
        <div className="act-item" key={key}>
          <div className="act-item-key">{key}</div>
          <div className="act-content" style={{ paddingLeft: '1rem', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
            {Object.entries(value).map(([subKey, subValue]) => 
              renderActValue(subKey, subValue)
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={`act-item ${isError ? 'is-error' : ''}`} key={key}>
        <div className="act-item-key">{key}</div>
        <div className="act-item-value">
          <code>{String(value)}</code>
        </div>
      </div>
    );
  };

  if (!activeTaskId) {
    return <div className="result-empty-state">No Active Task</div>;
  }

  if (loading && !act && !result && !verdict) {
    return (
      <div className="result-panel">
        <div className="result-empty-state">
          <div className="dot-pulse">Loading Results...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="result-panel">
      {verdict && (
        <VerdictBanner 
          constitutional={verdict.constitutional}
          ruling={verdict.ruling}
          evidence={verdict.evidence}
        />
      )}

      {act && (
        <div className="act-card">
          <div className="act-header">Executive Memorandum</div>
          <div className="act-content">
            {Object.entries(act).map(([key, value]) => renderActValue(key, value))}
          </div>
        </div>
      )}

      {result && (() => {
        let parsedResult: unknown = result;
        if (typeof result === 'string') {
          try {
            parsedResult = JSON.parse(result);
          } catch {
            // Keep as string
          }
        }

        return (
          <div className="act-card" style={{ marginTop: '1rem' }}>
            <div className="act-header" style={{ color: 'var(--color-accent-blue)' }}>Execution Output</div>
            <div className="act-content">
              {typeof parsedResult === 'object' && parsedResult !== null ? (
                Object.entries(parsedResult).map(([key, value]) => renderActValue(key, value))
              ) : (
                <div className="act-item-value" style={{ padding: '0 var(--spacing-md)' }}>
                  <ReactMarkdown>{String(parsedResult)}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      
      {!act && !result && !loading && (
        <div className="result-empty-state">
          No execution data found.
        </div>
      )}
    </div>
  );
};
