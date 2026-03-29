import { useAppDispatch, useAppState } from '../../contexts/AppContext';
import { useApi } from '../../hooks/useApi';

interface TaskCardProps {
  taskId: string;
  status: string;
  prompt: string;
}

export function TaskCard({ taskId, status, prompt }: TaskCardProps) {
  const dispatch = useAppDispatch();
  const { activeTaskId } = useAppState();
  const { deleteTask } = useApi();

  const isActive = activeTaskId === taskId;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTask(taskId);
      dispatch({ type: 'DELETE_TASK', taskId });
    } catch (err) {
      console.error('Failed to delete task:', err);
      alert('Failed to delete task');
    }
  };

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
        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', marginRight: '8px' }}>
          {taskId.split('-')[0]}
        </span>
        <button
          onClick={handleDelete}
          title="Delete Task"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
            transition: 'opacity 0.2s, color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = '#ef4444'; // Red color on hover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
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
