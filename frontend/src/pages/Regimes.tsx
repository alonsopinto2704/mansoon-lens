import { useMemo, useState } from 'react';
import { m } from 'motion/react';
import { useForecast, useVerification } from '../data';
import { escapeHtml, fixed, gateReason, mm, pct, regimeBlurb, regimeColor, REGIMES, titleDate, type Forecast } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { IndiaMap } from '../components/IndiaMap';
import { DayStrip, SourceControls } from '../components/Controls';
import { ErrorState, GateChip, LoadingBlock, Reveal, Skeleton, ease } from '../components/ui';


/** Row-normalised confusion matrix: each row is a true regime, cells show where its days were classified. */
function Confusion({ matrix, regimes }: { matrix: number[][]; regimes: string[] }) {
  const theme = useResolvedTheme();
  const cell = (share: number) => {
    const a = Math.round(8 + share * 86); // blue at 8–94% strength over the surface
    return theme === 'dark' ? `color-mix(in srgb, #5598e7 ${a}%, #111d2a)` : `color-mix(in srgb, #1c5cab ${a}%, #fffefb)`;
  };
  return (
    <div className="confusion" role="table" aria-label="Regime classifier confusion matrix, held-out season">
      <div role="row" className="cm-row cm-head">
        <span role="columnheader" className="cm-corner">True ↓ · Predicted →</span>
        {regimes.map((r) => <span role="columnheader" key={r}><i style={{ background: regimeColor(r, theme) }} />{r === 'Western disturbance' ? 'W. dist.' : r}</span>)}
      </div>
      {matrix.map((row, i) => {
        const total = row.reduce((a, b) => a + b, 0) || 1;
        return (
          <div role="row" className="cm-row" key={regimes[i]}>
            <span role="rowheader"><i style={{ background: regimeColor(regimes[i], theme) }} />{regimes[i]}</span>
            {row.map((n, j) => {
              const share = n / total;
              return (
                <span role="cell" key={j} className={`cm-cell${i === j ? ' is-diag' : ''}`} style={{ background: cell(share), color: share > 0.45 ? '#fff' : 'var(--text)' }}
                  title={`${regimes[i]} days predicted as ${regimes[j]}: ${n.toLocaleString('en-IN')} (${pct(share)})`}>
                  {pct(share)}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function RegimesPage() {
  const theme = useResolvedTheme();
  const verification = useVerification();
  const forecast = useForecast();
  const source = useForecastStore((s) => s.source);
  const [focus, setFocus] = useState<string | null>(null);
  const v = verification.data;
  const rows: Forecast[] = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const date = forecast.data?.date;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    rows.forEach((r) => { out[r.dominant_regime] = (out[r.dominant_regime] ?? 0) + 1; });
    return out;
  }, [rows]);
  const total = rows.length;
  const muted = theme === 'dark' ? '#1a2839' : '#e7e3da';
  const color = (i: Forecast) => (!focus || i.dominant_regime === focus ? regimeColor(i.dominant_regime, theme) : muted);
  const tooltip = (i: Forecast) => `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>Most likely regime</span><b>${escapeHtml(i.dominant_regime)}</b><span>Served</span><b>${mm(i.served_mm)}</b></div>`;

  return (
    <div className="page page-wide">
      <header className="ws-head">
        <div>
          <span className="label">Weather regimes · {source === 'live' ? 'live NWP' : 'held-out season'}</span>
          <h1 className="ws-title">{date ? titleDate(date, !(source === 'live')) : 'Weather regimes'}</h1>
        </div>
        <SourceControls />
      </header>
      <DayStrip />

      <div className="regime-layout">
        <div className="card map-card regime-map">
          {forecast.isError ? <div className="pad"><ErrorState error={forecast.error} /></div> : !total ? <Skeleton height="100%" className="map-skeleton" /> : (
            <div className="map-wrap"><IndiaMap items={rows} color={color} tooltip={tooltip} /></div>
          )}
        </div>
        <aside className="card regime-legend">
          <span className="label">Most likely regime · {total || '—'} districts</span>
          <p className="muted small">Select a regime to spotlight it on the map.</p>
          <ul>
            {REGIMES.map((r) => {
              const n = counts[r] ?? 0;
              const active = focus === r;
              return (
                <li key={r}>
                  <button className={`regime-row${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => setFocus(active ? null : r)}>
                    <span className="regime-row-top"><i style={{ background: regimeColor(r, theme) }} /><strong>{r}</strong><b className="num">{n}</b></span>
                    <span className="share-track"><m.span className="share-fill" style={{ background: regimeColor(r, theme) }} initial={{ width: 0 }} animate={{ width: `${total ? (n / total) * 100 : 0}%` }} transition={{ duration: 0.6, ease }} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
          {focus && <button className="btn btn-ghost" onClick={() => setFocus(null)}>Show all regimes</button>}
        </aside>
      </div>

      {verification.isError ? <ErrorState error={verification.error} /> : !v ? <LoadingBlock rows={6} /> : (
        <>
          <section className="section">
            <Reveal className="section-head">
              <div>
                                <h2>Why regimes matter: the raw model errs differently in each</h2>
              </div>
            </Reveal>
            <div className="regime-grid">
              {v.regimes.map((name, i) => {
                const metric = v.classifier.per_regime.find((r) => r.regime === name);
                const gate = v.gate[name];
                const raw = v.scores[name]?.Raw?.['64.5'];
                const ours = v.scores[name]?.['Regime-aware']?.['64.5'];
                return (
                  <Reveal key={name} delay={i * 0.05} className="regime-card card">
                    <div className="regime-top">
                      <span className="regime-swatch" style={{ background: regimeColor(name, theme) }} />
                      <h3>{name}</h3>
                      <GateChip status={gate?.status ?? 'Serving raw'} />
                    </div>
                    <p className="muted">{regimeBlurb[name]}</p>
                    <dl className="regime-metrics">
                      <div><dt>Raw model bias</dt><dd className="num">{raw ? `${raw.bias > 0 ? '+' : ''}${fixed(raw.bias, 1)} mm` : '—'}</dd></div>
                      <div><dt>RMSE raw → ours</dt><dd className="num">{raw && ours ? `${fixed(raw.rmse, 1)} → ${fixed(ours.rmse, 1)}` : '—'}</dd></div>
                      <div><dt>Recognised</dt><dd className="num">{metric ? pct(metric.recall) : '—'}</dd></div>
                    </dl>
                    <p className="regime-gate small">{gate ? gateReason(gate.reason) : ''}</p>
                  </Reveal>
                );
              })}
            </div>
          </section>

          <section className="section">
            <Reveal className="section-head">
              <div>
                                <h2>Classifier check: how often each regime is recognised (held-out season)</h2>
                <p>Each row is the true regime; the cells show where its district-days were classified. A strong diagonal means the right correction is chosen.</p>
              </div>
            </Reveal>
            <Reveal className="card confusion-card"><Confusion matrix={v.classifier.confusion_matrix} regimes={v.regimes} /></Reveal>
          </section>
        </>
      )}
    </div>
  );
}
