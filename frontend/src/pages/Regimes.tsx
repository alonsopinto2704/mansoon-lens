import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useForecast, useVerification } from '../data';
import { formatDate, gateReason, modelColors, pct, regimeBlurb, regimeColor } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { ChartCard, ChartTooltip, LegendRow, chartTheme } from '../components/charts';
import { ErrorState, GateChip, LoadingBlock, PageHeader, Reveal, Section, ease } from '../components/ui';

export default function RegimesPage() {
  const theme = useResolvedTheme();
  const ct = chartTheme(theme);
  const date = useForecastStore((s) => s.date);
  const verification = useVerification();
  const forecast = useForecast();
  const [open, setOpen] = useState<string | null>(null);
  const v = verification.data;
  const rows = forecast.data?.items;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    rows?.forEach((r) => { out[r.dominant_regime] = (out[r.dominant_regime] ?? 0) + 1; });
    return out;
  }, [rows]);
  const total = rows?.length ?? 0;
  const series = [{ key: 'precision', label: 'Precision', color: modelColors[theme]['Regime-aware'] }, { key: 'recall', label: 'Recall', color: modelColors[theme].Global }];

  return (
    <div className="page">
      <PageHeader title="Weather regimes" description="Six recurring monsoon patterns. Every district forecast carries a probability for each, and the correction blends all six." />

      {verification.isError ? <ErrorState error={verification.error} /> : !v ? <LoadingBlock rows={6} /> : (
        <>
          {total > 0 && (
            <Reveal className="card mix-card">
              <div className="mix-head"><span className="label">Most likely regime by district</span><span className="muted small">{date && formatDate(date)} · {total} districts</span></div>
              <div className="mix-bar" role="img" aria-label={v.regimes.map((r) => `${r} ${counts[r] ?? 0}`).join(', ')}>
                {v.regimes.filter((r) => counts[r]).map((r) => (
                  <m.span key={r} style={{ background: regimeColor(r, theme) }} initial={{ flexGrow: 0 }} animate={{ flexGrow: counts[r] }} transition={{ duration: 0.8, ease }} title={`${r}: ${counts[r]}`} />
                ))}
              </div>
              <div className="mix-legend">
                {v.regimes.map((r) => <span key={r}><i style={{ background: regimeColor(r, theme) }} />{r}<b className="num">{counts[r] ?? 0}</b></span>)}
              </div>
            </Reveal>
          )}

          <div className="regime-grid">
            {v.regimes.map((name, i) => {
              const metric = v.classifier.per_regime.find((r) => r.regime === name);
              const gate = v.gate[name];
              const isOpen = open === name;
              return (
                <Reveal key={name} delay={i * 0.05}>
                  <button className={`regime-card card card-hover ${isOpen ? 'is-open' : ''}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : name)}>
                    <div className="regime-top">
                      <span className="regime-swatch" style={{ background: regimeColor(name, theme) }} />
                      <h3>{name}</h3>
                      <GateChip status={gate?.status ?? 'Serving raw'} />
                    </div>
                    <p className="muted">{regimeBlurb[name]}</p>
                    <dl className="regime-metrics">
                      <div><dt>Districts today</dt><dd className="num">{counts[name] ?? 0}</dd></div>
                      <div><dt>Precision</dt><dd className="num">{metric ? pct(metric.precision) : '—'}</dd></div>
                      <div><dt>Recall</dt><dd className="num">{metric ? pct(metric.recall) : '—'}</dd></div>
                    </dl>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <m.div className="regime-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }}>
                          <p><strong>Gate decision:</strong> {gate && gateReason(gate.reason)}</p>
                          <p className="muted small">{gate?.events.toLocaleString('en-IN')} heavy-rain events in the held-out season.</p>
                        </m.div>
                      )}
                    </AnimatePresence>
                    <span className="regime-toggle muted small">{isOpen ? 'Hide gate decision' : 'Show gate decision'}</span>
                  </button>
                </Reveal>
              );
            })}
          </div>

          <Section title="How well regimes are recognised" description="Held-out season. Precision: how often a predicted regime was right. Recall: how often a real regime was caught.">
            <ChartCard title="Regime classifier accuracy" legend={<LegendRow items={series.map((s) => ({ label: s.label, color: s.color }))} />}>
              <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                <BarChart data={v.classifier.per_regime} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={ct.grid} />
                  <XAxis dataKey="regime" tick={ct.tick} axisLine={{ stroke: ct.grid }} tickLine={false} interval={0} />
                  <YAxis domain={[0, 1]} tickFormatter={pct} tick={ct.tick} axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ fill: ct.cursor }} content={<ChartTooltip format={pct} />} />
                  {series.map((s) => <RBar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </Section>
        </>
      )}
    </div>
  );
}
