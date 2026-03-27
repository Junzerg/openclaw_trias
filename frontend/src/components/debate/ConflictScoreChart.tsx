import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useAppState } from '../../contexts/AppContext';

export function ConflictScoreChart() {
  const { debate, activeTaskId } = useAppState();

  const data = useMemo(() => {
    const scores = debate.conflictScores || [];
    return scores.map((val, idx) => ({
      round: idx + 1,
      score: val,
    }));
  }, [debate.conflictScores]);

  if (!activeTaskId || data.length === 0) {
    return null;
  }

  const threshold = 30; // 默认值 30（后续可由 constitution.yaml 提供支持）

  return (
    <div className="conflict-score-chart-container">
      <div className="chart-title">Conflict Score</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="round" 
              stroke="rgba(255,255,255,0.3)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={10}
            />
            <YAxis 
              domain={[0, 100]} 
              stroke="rgba(255,255,255,0.3)" 
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine 
              y={threshold} 
              stroke="red" 
              strokeDasharray="5 5" 
            />
            <Line 
              type="monotone" 
              dataKey="score" 
              stroke="var(--color-accent-orange, #f59e0b)" 
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-bg, #0a0a0a)', stroke: 'var(--color-accent-orange, #f59e0b)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={true}
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
