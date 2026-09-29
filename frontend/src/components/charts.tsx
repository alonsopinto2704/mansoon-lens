import type { ReactNode } from 'react';
import type { Theme } from '../lib';

/** Recessive axis/grid styling per theme for Recharts. */
export function chartTheme(theme: Theme) {
  const dark = theme === 'dark';
  return {
    grid: dark ? '#223049' : '#e8ecf1',
    axis: dark ? '#8391a7' : '#6b7686',
    cursor: dark ? '#ffffff10' : '#0d172608',
    tick: { fontSize: 12, fill: dark ? '#aab6c8' : '#4a5566' },
  };
}

type TooltipProps = { active?: boolean; label?: string | number; payload?: { name: string; value: number; color: string }[]; format?: (v: number) => string; labelFormat?: (l: string | number) => string };

export function ChartTooltip({ active, label, payload, format = (v) => v.toFixed(3), labelFormat = (l) => String(l) }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <strong>{labelFormat(label ?? '')}</strong>
      {payload.map((p) => <div key={p.name}><i style={{ background: p.color }} />{p.name}<b className="num">{format(p.value)}</b></div>)}
    </div>
  );
}

export function LegendRow({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return <div className="legend-row">{items.map((i) => <span key={i.label}><i className={i.dashed ? 'dashed' : ''} style={{ background: i.dashed ? undefined : i.color, borderColor: i.color }} />{i.label}</span>)}</div>;
}

export function ChartCard({ title, description, children, legend }: { title: string; description?: string; children: ReactNode; legend?: ReactNode }) {
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div><h3>{title}</h3>{description && <p className="muted small">{description}</p>}</div>
        {legend}
      </div>
      <div className="chart-body">{children}</div>
    </div>
  );
}
