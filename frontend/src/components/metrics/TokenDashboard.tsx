import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useAppState } from '../../contexts/AppContext';
import './TokenDashboard.css';

// Branch color palette — aligned with design-system.css variables
const BRANCH_COLORS = {
  legislative: '#6366f1',  // var(--color-legislative) — Indigo/Purple
  executive: '#3b82f6',    // var(--color-executive) — Blue
  judicial: '#f59e0b',     // var(--color-judicial) — Amber/Yellow
} as const;

const BRANCH_LABELS: Record<string, string> = {
  legislative: 'Legislative',
  executive: 'Executive',
  judicial: 'Judicial',
};

interface PieDataEntry {
  name: string;
  value: number;
  color: string;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Custom tooltip for the pie chart */
const PieTooltip: React.FC<{ active?: boolean; payload?: { name: string; value: number; payload: PieDataEntry }[] }> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: entry } = payload[0];
  return (
    <div style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 6,
      padding: '6px 10px',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      color: entry.color,
      boxShadow: 'var(--shadow-elevated)',
    }}>
      <strong>{name}</strong>: {formatTokenCount(value)} tokens
    </div>
  );
};

/** Custom tooltip for the line chart */
const LineTooltip: React.FC<{ active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-bg-panel)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 6,
      padding: '8px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.65rem',
      boxShadow: 'var(--shadow-elevated)',
    }}>
      <div style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Event #{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {formatTokenCount(p.value)}
        </div>
      ))}
    </div>
  );
};

/** Custom label renderer for pie chart */
const renderPieLabel = ({ name, percent }: { name?: string; percent?: number }): string | null => {
  if (!percent || percent < 0.05) return null;
  return `${name ?? ''} ${(percent * 100).toFixed(0)}%`;
};

export const TokenDashboard: React.FC = () => {
  const { tokens } = useAppState();
  const hasData = tokens.total > 0;

  // Pie chart data
  const pieData = useMemo<PieDataEntry[]>(() => {
    return [
      { name: BRANCH_LABELS.legislative, value: tokens.legislative, color: BRANCH_COLORS.legislative },
      { name: BRANCH_LABELS.executive, value: tokens.executive, color: BRANCH_COLORS.executive },
      { name: BRANCH_LABELS.judicial, value: tokens.judicial, color: BRANCH_COLORS.judicial },
    ].filter(d => d.value > 0);
  }, [tokens.legislative, tokens.executive, tokens.judicial]);

  // Line chart data (timeline)
  const lineData = useMemo(() => tokens.timeline, [tokens.timeline]);

  return (
    <div className="token-dashboard">
      {/* Header */}
      <div className="token-dashboard-header">
        <span className="dashboard-icon">⚡</span>
        <h3>Token</h3>
        {hasData && (
          <span className="token-header-total">{formatTokenCount(tokens.total)}</span>
        )}
      </div>

      {hasData && (
        <>
          {/* Summary Cards */}
          <div className="token-summary-grid">
            <div className="token-summary-card legislative">
              <div className="token-card-label">Legis.</div>
              <div className="token-card-value">{formatTokenCount(tokens.legislative)}</div>
            </div>
            <div className="token-summary-card executive">
              <div className="token-card-label">Exec.</div>
              <div className="token-card-value">{formatTokenCount(tokens.executive)}</div>
            </div>
            <div className="token-summary-card judicial">
              <div className="token-card-label">Judic.</div>
              <div className="token-card-value">{formatTokenCount(tokens.judicial)}</div>
            </div>
          </div>

          {/* Pie Chart */}
          <div className="token-chart-section">
            <div className="token-chart-title">
              <span className="chart-icon">🥧</span>
              三权消耗占比
            </div>
            <div className="token-chart-wrapper">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={55}
                    paddingAngle={3}
                    dataKey="value"
                    label={renderPieLabel}
                    labelLine={false}
                    stroke="none"
                    animationBegin={0}
                    animationDuration={800}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={entry.color}
                        style={{ filter: `drop-shadow(0 0 4px ${entry.color}40)` }}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.6rem',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Line Chart — Cumulative Timeline */}
          {lineData.length > 1 && (
            <div className="token-chart-section">
              <div className="token-chart-title">
                <span className="chart-icon">📈</span>
                累计消耗趋势
              </div>
              <div className="token-chart-wrapper">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={lineData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="index"
                      tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'var(--font-mono)' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#9ca3af', fontSize: 9, fontFamily: 'var(--font-mono)' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                      tickFormatter={(v: number) => formatTokenCount(v)}
                    />
                    <Tooltip content={<LineTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="legislative"
                      name="Legislative"
                      stroke={BRANCH_COLORS.legislative}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3, stroke: BRANCH_COLORS.legislative, strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="executive"
                      name="Executive"
                      stroke={BRANCH_COLORS.executive}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3, stroke: BRANCH_COLORS.executive, strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="judicial"
                      name="Judicial"
                      stroke={BRANCH_COLORS.judicial}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3, stroke: BRANCH_COLORS.judicial, strokeWidth: 2 }}
                    />
                    <Legend
                      iconType="line"
                      iconSize={10}
                      wrapperStyle={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6rem',
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!hasData && (
        <div className="token-empty-state">
          <span className="token-empty-icon">📊</span>
          等待 Pipeline 执行…
        </div>
      )}
    </div>
  );
};

