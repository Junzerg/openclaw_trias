import { useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAppState, useAppDispatch } from '../../contexts/AppContext';
import { TaskCard } from './TaskCard';

export function TaskList() {
  const { fetchTasks } = useApi();
  const { tasks } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    let mounted = true;
    
    const loadTasks = async () => {
      try {
        const res = await fetchTasks(0, 50); // Increased limit from 10 to 50
        if (mounted) {
          dispatch({ 
            type: 'SET_TASKS', 
            tasks: res.tasks.map(t => ({ taskId: t.task_id, status: t.bill_state, prompt: t.petition }))
          });
        }
      } catch (err) {
        console.error('[TaskList] Failed to fetch tasks:', err);
      }
    };

    loadTasks(); // Fetch immediately on mount
    const interval = setInterval(loadTasks, 10000); // Polling every 10s

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchTasks, dispatch]);

  return (
    <div className="task-list-container" style={{
      display: 'flex',
      flexDirection: 'column',
      marginTop: 'var(--spacing-md)',
      paddingTop: 'var(--spacing-md)',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      flexGrow: 1, // Let it expand to fill available space
      overflow: 'hidden'
    }}>
      <h3 style={{ 
        fontSize: '12px', 
        color: 'var(--color-text-secondary)', 
        textTransform: 'uppercase', 
        letterSpacing: '0.05em',
        margin: '0 0 var(--spacing-sm) 0',
        flexShrink: 0
      }}>
        Task History
      </h3>
      <div className="task-list-scrollable" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-sm)',
        overflowY: 'auto',
        flexGrow: 1,
        paddingRight: 'var(--spacing-xs)' // Add a little space for the scrollbar
      }}>
        {tasks.map(task => (
          <TaskCard 
            key={task.taskId} 
            taskId={task.taskId} 
            status={task.status} 
            prompt={task.prompt} 
          />
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--spacing-md) 0' }}>
            No petitions yet.
          </div>
        )}
      </div>
    </div>
  );
}
