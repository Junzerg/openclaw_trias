import { useAppDispatch, useAppState } from '../../contexts/AppContext';

interface TaskCardProps {
  taskId: string;
  status: string;
  prompt: string;
}

export function TaskCard({ taskId, status, prompt }: TaskCardProps) {
  const dispatch = useAppDispatch();
  const { activeTaskId } = useAppState();

  const isActive = activeTaskId === taskId;

  const getStatusColor = (s: string) => {
    const sUpper = s.toUpperCase();
    if (sUpper === 'PETITION') return 'var(--color-text-secondary)';
    if (['DEBATING', 'DEBATE_PROPOSE', 'DEBATE_REBUTTAL', 'VOTED', 'VETOED'].includes(sUpper)) return 'var(--color-legislative)';
    if (['EXECUTING', 'PENDING_EXECUTION'].includes(sUpper)) return 'var(--color-executive)';
    if (['CONSTITUTIONAL', 'UNCONSTITUTIONAL', 'JUDICIAL_REVIEW'].includes(sUpper)) return 'var(--color-judicial)';
    if (sUpper === 'DELIVERED') return 'var(--color-accent-green)';
    return 'var(--color-text-secondary)';
  };

  return (
    <div 
      className={`task-card ${isActive ? 'active' : ''}`}
      onClick={() => dispatch({ type: 'SET_ACTIVE_TASK', taskId })}
      style={{
        padding: 'var(--spacing-md)',
        borderRadius: '8px',
        backgroundColor: isActive ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
        border: `1px solid ${isActive ? 'var(--color-accent-blue)' : 'rgba(255,255,255,0.1)'}`,
        cursor: 'pointer',
        transition: 'all var(--transition-fast)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
        <span 
          style={{
            display: 'inline-block',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 'bold',
            fontFamily: 'var(--font-mono)',
            backgroundColor: getStatusColor(status),
            color: '#fff',
            marginRight: 'auto'
          }}
        >
          {status.toUpperCase().replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {taskId.split('-')[0]}
        </span>
      </div>
      <div 
        style={{
          fontSize: '12px',
          color: 'var(--color-text-primary)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
        title={prompt}
      >
        {prompt.length > 100 ? `${prompt.slice(0, 100)}...` : prompt}
      </div>
    </div>
  );
}
