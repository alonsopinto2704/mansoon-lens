import { useState } from 'react';
import type { Score } from '../lib';

type Series = { key: string; label: string; color: string; points: { threshold: string; score: Score }[] };

const W = 420, H = 400, L = 48, R = 16, T = 14, B = 44;
const x = (sr: number) => L + sr * (W - L - R);
const y = (pod: number) => H - B - pod * (H - T - B);
const CSI = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const BIAS = [0.3, 0.5, 0.8, 1, 1.3, 2, 3];

/** CSI contour: POD = 1 / (1/csi + 1 - 1/SR), defined for SR ≥ csi. */
function contour(c: number) {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const sr = c + (1 - c) * (i / 60);
    const pod = 1 / (1 / c + 1 - 1 / sr);
    if (pod >= 0 && pod <= 1) pts.push(`${x(sr).toFixed(1)},${y(pod).toFixed(1)}`);
  }
  return pts.join(' ');
}

/**
 * Roebber (2009) performance diagram: success ratio (1 − FAR) against probability of detection,
 * with CSI contours (solid) and frequency-bias lines (dashed). Up and to the right is better.
 */
export function PerformanceDiagram({ series, active, grid, axis, text }: { series: Series[]; active: string; grid: string; axis: string; text: string }) {
  const [hover, setHover] = useState<{ label: string; threshold: string; s: Score } | null>(null);
  return (
    <div className="perf">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Performance diagram: success ratio against probability of detection for each model and threshold">
        {CSI.map((c) => (
          <g key={c}>
            <polyline points={contour(c)} fill="none" stroke={grid} strokeWidth={1} />
            {/* label where the contour crosses the diagonal SR = POD = 2c / (1 + c) */}
            <text x={x((2 * c) / (1 + c)) + 3} y={y((2 * c) / (1 + c)) - 3} fontSize="9.5" fill={axis} opacity={0.9}>{c.toFixed(1)}</text>
          </g>
        ))}
        {BIAS.map((b) => {
          const end = b >= 1 ? { sr: 1 / b, pod: 1 } : { sr: 1, pod: b };
          return (
            <g key={b}>
              <line x1={x(0)} y1={y(0)} x2={x(end.sr)} y2={y(end.pod)} stroke={axis} strokeOpacity={0.45} strokeDasharray="3 4" strokeWidth={1} />
              <text x={x(end.sr) + (b >= 1 ? 2 : -2)} y={y(end.pod) + (b >= 1 ? -3 : 11)} textAnchor={b >= 1 ? 'start' : 'end'} fontSize="9" fill={axis}>{b}</text>
            </g>
          );
        })}
        <rect x={x(0)} y={y(1)} width={x(1) - x(0)} height={y(0) - y(1)} fill="none" stroke={grid} />
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
          <g key={t} fontSize="10.5" fill={axis}>
            <text x={x(t)} y={H - B + 16} textAnchor="middle">{t.toFixed(1)}</text>
            <text x={L - 8} y={y(t) + 3.5} textAnchor="end">{t.toFixed(1)}</text>
          </g>
        ))}
        <text x={(x(0) + x(1)) / 2} y={H - 8} textAnchor="middle" fontSize="11.5" fill={text}>Success ratio (1 − FAR) →</text>
        <text transform={`translate(12 ${(y(0) + y(1)) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fill={text}>Probability of detection →</text>
        {series.map((sr) => {
          const pts = sr.points.filter((p) => p.score.pod !== null && p.score.far !== null);
          return (
            <g key={sr.key}>
              <polyline points={pts.map((p) => `${x(1 - (p.score.far ?? 0))},${y(p.score.pod ?? 0)}`).join(' ')} fill="none" stroke={sr.color} strokeWidth={1.5} strokeOpacity={0.55} />
              {pts.map((p) => {
                const on = p.threshold === active;
                const cx = x(1 - (p.score.far ?? 0)), cy = y(p.score.pod ?? 0);
                return (
                  <g key={p.threshold} onMouseEnter={() => setHover({ label: sr.label, threshold: p.threshold, s: p.score })} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
                    <circle cx={cx} cy={cy} r={12} fill="transparent" />
                    <circle cx={cx} cy={cy} r={on ? 6.5 : 4.5} fill={sr.color} stroke="var(--surface)" strokeWidth={2} opacity={on ? 1 : 0.75} />
                    {sr.key === 'Delivered' && <text x={cx + 9} y={cy - 7} fontSize="10" fontWeight={600} fill={text}>{p.threshold}</text>}
                    <title>{`${sr.label} · ≥ ${p.threshold} mm — POD ${(p.score.pod ?? 0).toFixed(3)}, success ratio ${(1 - (p.score.far ?? 0)).toFixed(3)}, CSI ${(p.score.csi ?? 0).toFixed(3)}`}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <p className="perf-readout" aria-live="polite">
        {hover ? <><b>{hover.label}</b> at ≥ {hover.threshold} mm · POD <b className="num">{(hover.s.pod ?? 0).toFixed(2)}</b> · FAR <b className="num">{(hover.s.far ?? 0).toFixed(2)}</b> · CSI <b className="num">{(hover.s.csi ?? 0).toFixed(2)}</b> · bias <b className="num">{((hover.s.pod ?? 0) / (1 - (hover.s.far ?? 0) || 1)).toFixed(2)}</b></>
          : <>Solid curves: CSI. Dashed lines: frequency bias. Numbers beside the delivered-forecast points are thresholds (mm). Point at a marker for its scores.</>}
      </p>
    </div>
  );
}
