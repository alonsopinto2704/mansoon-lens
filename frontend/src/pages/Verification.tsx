import { useState } from 'react';
import { m } from 'motion/react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useVerification } from '../data';
import { fixed, gateReason, mm, modelColors, pct, type Score } from '../lib';
import { useResolvedTheme } from '../store';
import { ChartCard, ChartTooltip, LegendRow, chartTheme } from '../components/charts';
import { PerformanceDiagram } from '../components/PerformanceDiagram';
import { Field } from '../components/Controls';
import { CountUp, ErrorState, GateChip, LoadingBlock, PageHeader, Section, Segmented } from '../components/ui';

const MODELS = ['Raw', 'Global', 'Regime-aware', 'Delivered'] as const;
const modelLabel = { Raw: 'Raw model', Global: 'Global fix', 'Regime-aware': 'Correction before gate', Delivered: 'Delivered forecast' };
const ciLabels: [string, string, number, string][] = [['raw_rmse', 'RMSE vs raw', 1, ' mm'], ['global_rmse', 'RMSE vs global', 1, ' mm'], ['raw_csi', 'CSI vs raw', 3, ''], ['global_csi', 'CSI vs global', 3, '']];

/** Bootstrap intervals of the improvement; a bound at or below zero fails the gate. */
function CiList({ ci }: { ci?: Record<string, [number, number]> }) {
  if (!ci) return <span className="muted">—</span>;
  const f = (n: number, d: number) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
  return (
    <ul className="ci-list">
      {ciLabels.map(([key, label, d, unit]) => {
        const [lo, hi] = ci[key];
        return <li key={key} className={lo > 0 ? 'ci-pass' : 'ci-fail'}><span>{label}</span><b className="num">{f(lo, d)} to {f(hi, d)}{unit}</b></li>;
      })}
    </ul>
  );
}

export default function VerificationPage() {
  const theme = useResolvedTheme();
  const ct = chartTheme(theme);
  const colors = modelColors[theme];
  const verification = useVerification();
  const [group, setGroup] = useState('Overall');
  const [threshold, setThreshold] = useState('64.5');
  const [comparisonMetric, setComparisonMetric] = useState<'rmse' | 'csi'>('rmse');
  const v = verification.data;

  if (verification.isError) return <div className="page"><ErrorState error={verification.error} /></div>;
  if (!v) return <div className="page"><LoadingBlock rows={8} /></div>;

  const scores = v.scores[group];
  const at = (m: string) => scores[m][threshold] as Score;
  const ours = at('Delivered');
  const raw = at('Raw');
  const reliability = v.reliability_by_group?.[group]?.[threshold] ?? (group === 'Overall' ? v.reliability[threshold] ?? [] : []);
  const perf = MODELS.map((m) => ({ key: m, label: modelLabel[m], color: colors[m], points: v.thresholds.map((t) => ({ threshold: String(t), score: scores[m][String(t)] as Score })) }));
  const leadModels = ['Raw', 'Delivered'] as const;
  const byLead = [1, 2, 3, 4, 5].map((n) => ({ lead: `Day +${n}`, ...Object.fromEntries(leadModels.flatMap((m) => {
    const sc = v.scores[`Lead ${n}`]?.[m]?.[threshold] as Score | undefined;
    return [[`${modelLabel[m]}|rmse`, sc?.rmse ?? null], [`${modelLabel[m]}|csi`, sc?.csi ?? null]];
  })) }));
  const legend = <LegendRow items={MODELS.map((m) => ({ label: modelLabel[m], color: colors[m] }))} />;
  const leadLegend = <LegendRow items={leadModels.map((m) => ({ label: modelLabel[m], color: colors[m] }))} />;
  const groups = ['Overall', ...v.regimes, ...[1, 2, 3, 4, 5].map((n) => `Lead ${n}`)];
  const rmseGain = raw.rmse ? (raw.rmse - ours.rmse) / raw.rmse : 0;
  const comparison = MODELS.map((m) => ({ model: m, value: at(m)[comparisonMetric] })).sort((a, b) => comparisonMetric === 'rmse'
    ? (a.value ?? Infinity) - (b.value ?? Infinity)
    : (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const comparisonMax = Math.max(0, ...comparison.map(({ value }) => value ?? 0));
  const rmseKey = String(v.thresholds[0]);
  const regimeGains = v.regimes.map((name) => {
    const base = v.scores[name]?.Raw?.[rmseKey]?.rmse ?? 0;
    const delivered = v.scores[name]?.Delivered?.[rmseKey]?.rmse ?? 0;
    return { name, gain: base ? (base - delivered) / base : 0, status: v.gate[name]?.status };
  });
  const largestRegimeGain = Math.max(0.01, ...regimeGains.map(({ gain }) => Math.abs(gain)));
  const observedEvents = ours.hits + ours.misses;
  const forecastEvents = ours.hits + ours.false_alarms;

  const summary = `Delivered forecast, ${group}, ≥ ${threshold} mm: RMSE ${mm(ours.rmse)} against ${mm(raw.rmse)} for the raw model${rmseGain > 0 ? ` (${pct(rmseGain)} lower)` : ''}; CSI ${fixed(ours.csi, 3)} against ${fixed(raw.csi, 3)} raw.`;

  return (
    <div className="page">
      <PageHeader title="Verification"
        description="Raw rainfall, a global correction, the correction before gating and the delivered forecast, compared on the synthetic held-out 2025 season."
        actions={<>
          <a className="btn btn-secondary" href="/api/v1/verification/report.csv"><Download size={16} aria-hidden /> CSV</a>
          <a className="btn btn-secondary" href="/api/v1/verification/report.pdf"><Download size={16} aria-hidden /> PDF report</a>
        </>} />

      <p className="source-note">{v.delivered_evaluation}</p>
      <p className="verif-summary" aria-live="polite">{summary}</p>
      <div className="filter-bar">
        <Field label="Subset">
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Subset">
            <optgroup label="All"><option>Overall</option></optgroup>
            <optgroup label="By regime">{v.regimes.map((r) => <option key={r}>{r}</option>)}</optgroup>
            <optgroup label="By lead time">{groups.filter((g) => g.startsWith('Lead')).map((g) => <option key={g}>{g}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Event threshold">
          <Segmented id="vthreshold" label="Rainfall threshold" value={threshold} onChange={setThreshold}
            options={v.thresholds.map((t) => ({ value: String(t), label: `≥ ${t} mm` }))} />
        </Field>
      </div>

      <div className="kpis">
        <div className="kpi card"><span>Forecasts scored</span><strong><CountUp value={v.subset_rows?.[group] ?? v.test_rows} /></strong><small>{group}</small></div>
        <div className="kpi card"><span>Error (RMSE)</span><strong><CountUp value={ours.rmse} format={(n) => mm(n)} /></strong><small>{rmseGain > 0 ? `${pct(rmseGain)} lower than raw` : `raw: ${mm(raw.rmse)}`}</small></div>
        <div className="kpi card"><span>Critical success index</span><strong><CountUp value={ours.csi ?? 0} format={(n) => n.toFixed(3)} /></strong><small>raw: {fixed(raw.csi, 3)} · higher is better</small></div>
        <div className="kpi card"><span>Heavy-rain events</span><strong><CountUp value={ours.hits + ours.misses} /></strong><small>in this subset</small></div>
      </div>

      <div className="grid-2">
        <ChartCard title="Which model performs best?" description={`${group} · ${comparisonMetric === 'rmse' ? 'RMSE across all rainfall amounts' : `CSI at ≥ ${threshold} mm`} · ranked by score`}>
          <div className="chart-switch"><Segmented id="comparison-metric" label="Comparison metric" value={comparisonMetric} onChange={(value) => setComparisonMetric(value as 'rmse' | 'csi')}
            options={[{ value: 'rmse', label: 'Error · RMSE' }, { value: 'csi', label: 'Heavy-rain skill · CSI' }]} /></div>
          <div className="comparison-bars" role="list" aria-label={`Models ranked by ${comparisonMetric.toUpperCase()}`}>
            {comparison.map(({ model, value }, index) => (
              <m.div layout="position" transition={{ duration: 0.24 }} className="comparison-row" role="listitem" key={model}>
                <div className="comparison-row-label"><span><i className="comparison-swatch" style={{ background: colors[model] }} />{modelLabel[model]}</span><b className="num">{fixed(value, comparisonMetric === 'rmse' ? 1 : 3)}{comparisonMetric === 'rmse' && value !== null ? ' mm' : ''}</b></div>
                <div className="comparison-track"><span style={{ width: `${value && comparisonMax ? Math.max(2, value / comparisonMax * 100) : 0}%`, background: colors[model] }} /></div>
                {index === 0 && <span className="sr-only">Best of the four models for this score</span>}
              </m.div>
            ))}
          </div>
          <p className="chart-footnote">{comparisonMetric === 'rmse' ? 'Lower error is better. Bar length shows the score, so the shortest bar ranks first.' : 'Higher skill is better. Bar length shows the critical success index.'}</p>
        </ChartCard>

        <ChartCard title="Error change by regime" description="Delivered forecast versus raw · RMSE across all rainfall amounts">
          <div className="regime-gains" role="list" aria-label="RMSE change for each weather regime">
            {regimeGains.map(({ name, gain, status }) => (
              <div className="regime-gain-row" role="listitem" key={name}>
                <span className="regime-gain-name">{name}<small>{status === 'Corrected' ? 'Correction served' : 'Raw served'}</small></span>
                <div className="regime-gain-plot" aria-hidden="true"><i className="regime-gain-zero" /><span className={gain >= 0 ? 'is-better' : 'is-worse'} style={{ width: `${Math.abs(gain) / largestRegimeGain * 48}%`, left: gain >= 0 ? '50%' : undefined, right: gain < 0 ? '50%' : undefined }} /></div>
                <b className="num">{gain > 0 ? '+' : ''}{(gain * 100).toFixed(1)}%</b>
              </div>
            ))}
          </div>
          <p className="chart-footnote">Right of centre means less error. The gate also checks CSI and confidence intervals; an error gain alone does not pass it.</p>
        </ChartCard>
      </div>

      <div className="grid-2">
        <ChartCard title="Performance diagram" description={`${group} · all three IMD thresholds · larger points: ≥ ${threshold} mm`} legend={legend}>
          <PerformanceDiagram series={perf} active={threshold} grid={ct.grid} axis={ct.axis} text={ct.tick.fill} />
        </ChartCard>

        <div className="card table-card">
          <div className="table-head"><div><h3>All scores</h3><p className="muted small">↓ lower is better · ↑ higher is better</p></div></div>
          <div className="table-scroll">
            <table className="table table-compact">
              <thead><tr><th>Score</th>{MODELS.map((m) => <th key={m} className="align-right"><span className="th-swatch" style={{ background: colors[m] }} />{modelLabel[m]}</th>)}</tr></thead>
              <tbody>
                {([['RMSE (mm) ↓', 'rmse', 1], ['Bias (mm)', 'bias', 2], ['POD ↑', 'pod', 3], ['FAR ↓', 'far', 3], ['CSI ↑', 'csi', 3], ['ETS ↑', 'ets', 3], ['Brier ↓', 'brier', 3]] as const).map(([label, key, d]) => (
                  <tr key={key}><td>{label}</td>{MODELS.map((m) => <td key={m} className="num align-right">{fixed(at(m)[key] as number | null, d)}</td>)}</tr>
                ))}
                {(['1', '3', '5'] as const).map((n) => (
                  <tr key={n}><td>FSS · {n} district{n === '1' ? '' : 's'} ↑</td>{MODELS.map((m) => <td key={m} className="num align-right">{fixed(at(m).fss?.[n], 3)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {(['rmse', 'csi'] as const).map((metric) => (
          <ChartCard key={metric} title={metric === 'rmse' ? 'Rainfall error by lead day' : 'Heavy-rain skill by lead day'}
            description={metric === 'rmse' ? 'Overall · RMSE (mm), lower is better' : `Overall · CSI at ≥ ${threshold} mm, higher is better`} legend={leadLegend}>
            <ResponsiveContainer width="100%" height="100%" minHeight={260}>
              <LineChart data={byLead} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={ct.grid} />
                <XAxis dataKey="lead" tick={ct.tick} axisLine={{ stroke: ct.grid }} tickLine={false} />
                <YAxis tick={ct.tick} axisLine={false} tickLine={false} width={40} domain={metric === 'csi' ? [0, 'auto'] : ['auto', 'auto']} tickFormatter={(n: number) => (metric === 'csi' ? n.toFixed(2) : n.toFixed(0))} />
                <Tooltip content={<ChartTooltip format={(n) => (metric === 'csi' ? n.toFixed(3) : `${n.toFixed(1)} mm`)} />} />
                {leadModels.map((m) => (
                  <Line key={m} name={modelLabel[m]} dataKey={`${modelLabel[m]}|${metric}`} stroke={colors[m]} strokeWidth={m === 'Delivered' ? 2.5 : 2}
                    dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        ))}
      </div>

      <div className="grid-2">
        <ChartCard title="Probability reliability" description={`${group} · forecast chance vs. observed frequency at ≥ ${threshold} mm. The gate does not change probabilities.`}
          legend={<LegendRow items={[{ label: 'Probability model', color: colors['Regime-aware'] }, { label: 'Perfect', color: ct.axis, dashed: true }]} />}>
          {!reliability.length ? <p className="muted small">Too few forecasts in this subset to plot reliability at ≥ {threshold} mm.</p> : <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            <LineChart data={reliability} margin={{ right: 12 }}>
              <CartesianGrid stroke={ct.grid} />
              <XAxis dataKey="forecast" type="number" domain={[0, 1]} tickFormatter={pct} tick={ct.tick} axisLine={{ stroke: ct.grid }} tickLine={false} />
              <YAxis domain={[0, 1]} tickFormatter={pct} tick={ct.tick} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip format={pct} labelFormat={(l) => `Forecast ${pct(Number(l))}`} showCount />} />
              <Line name="Perfect" dataKey="forecast" stroke={ct.axis} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line name="Observed" type="monotone" dataKey="observed" stroke={colors['Regime-aware']} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>}
        </ChartCard>

        <ChartCard title="Where events went" description={`Delivered forecast · ${group} · ≥ ${threshold} mm`}>
          <div className="outcome-chart">
            <div className="outcome-row"><div><strong>Observed heavy rain</strong><span className="num">{observedEvents.toLocaleString('en-IN')} events</span></div>
              <div className="outcome-track" role="img" aria-label={`${ours.hits.toLocaleString('en-IN')} hits and ${ours.misses.toLocaleString('en-IN')} misses among observed events`}>
                <span className="outcome-hit" style={{ width: `${observedEvents ? ours.hits / observedEvents * 100 : 0}%` }} /><span className="outcome-miss" style={{ width: `${observedEvents ? ours.misses / observedEvents * 100 : 0}%` }} />
              </div><p><span><i className="outcome-key outcome-hit" />Hits <b className="num">{ours.hits.toLocaleString('en-IN')}</b></span><span><i className="outcome-key outcome-miss" />Misses <b className="num">{ours.misses.toLocaleString('en-IN')}</b></span></p></div>
            <div className="outcome-row"><div><strong>Forecast heavy rain</strong><span className="num">{forecastEvents.toLocaleString('en-IN')} forecasts</span></div>
              <div className="outcome-track" role="img" aria-label={`${ours.hits.toLocaleString('en-IN')} hits and ${ours.false_alarms.toLocaleString('en-IN')} false alarms among forecast events`}>
                <span className="outcome-hit" style={{ width: `${forecastEvents ? ours.hits / forecastEvents * 100 : 0}%` }} /><span className="outcome-false" style={{ width: `${forecastEvents ? ours.false_alarms / forecastEvents * 100 : 0}%` }} />
              </div><p><span><i className="outcome-key outcome-hit" />Hits <b className="num">{ours.hits.toLocaleString('en-IN')}</b></span><span><i className="outcome-key outcome-false" />False alarms <b className="num">{ours.false_alarms.toLocaleString('en-IN')}</b></span></p></div>
          </div>
          <p className="chart-footnote">{ours.correct_negatives.toLocaleString('en-IN')} correct negatives are excluded from these event-focused bars.</p>
        </ChartCard>
      </div>

      <Section title="The verification gate" description="Overall, by regime. A regime’s correction is served only if RMSE and heavy-rain CSI both improve on the raw and global baselines, with a positive lower 95% bootstrap bound.">
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Regime</th><th>Decision</th><th className="align-right">Events</th><th>Improvement, 95% interval</th><th>Reason</th></tr></thead>
              <tbody>
                {v.regimes.map((name) => (
                  <tr key={name}><td><strong>{name}</strong></td><td><GateChip status={v.gate[name].status} /></td><td className="num align-right">{v.gate[name].events.toLocaleString('en-IN')}</td><td><CiList ci={v.gate[name].confidence_intervals} /></td><td className="muted">{gateReason(v.gate[name].reason)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}
