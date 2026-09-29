import { useState } from 'react';
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { useVerification } from '../data';
import { fixed, gateReason, mm, modelColors, pct, type Score } from '../lib';
import { useResolvedTheme } from '../store';
import { ChartCard, ChartTooltip, LegendRow, chartTheme } from '../components/charts';
import { Field, Toolbar } from '../components/Controls';
import { CountUp, ErrorState, GateChip, LoadingBlock, PageHeader, Reveal, Section, Segmented } from '../components/ui';

const MODELS = ['Raw', 'Global', 'Regime-aware'] as const;
const modelLabel = { Raw: 'Raw model', Global: 'Global fix', 'Regime-aware': 'MonsoonLens' };
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
  const v = verification.data;

  if (verification.isError) return <div className="page"><ErrorState error={verification.error} /></div>;
  if (!v) return <div className="page"><LoadingBlock rows={8} /></div>;

  const scores = v.scores[group];
  const at = (m: string) => scores[m][threshold] as Score;
  const ours = at('Regime-aware');
  const raw = at('Raw');
  const skill = ['csi', 'pod', 'ets'].map((k) => ({ name: k.toUpperCase(), ...Object.fromEntries(MODELS.map((m) => [modelLabel[m], at(m)[k as 'csi'] ?? 0])) }));
  const groups = ['Overall', ...v.regimes, ...[1, 2, 3, 4, 5].map((n) => `Lead ${n}`)];
  const rmseGain = raw.rmse ? (raw.rmse - ours.rmse) / raw.rmse : 0;

  return (
    <div className="page">
      <PageHeader title="Verification" description="How the raw model, a single global correction and MonsoonLens compare on a season the models never saw."
        actions={<>
          <a className="btn btn-secondary" href="/api/v1/verification/report.csv"><Download size={16} aria-hidden /> CSV</a>
          <a className="btn btn-secondary" href="/api/v1/verification/report.pdf"><Download size={16} aria-hidden /> PDF report</a>
        </>} />

      <Toolbar>
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
      </Toolbar>

      <div className="kpis">
        <Reveal className="kpi card"><span>Forecasts scored</span><strong><CountUp value={v.test_rows} /></strong><small>held-out season</small></Reveal>
        <Reveal className="kpi card" delay={0.05}><span>Error (RMSE)</span><strong><CountUp value={ours.rmse} format={(n) => mm(n)} /></strong><small>{rmseGain > 0 ? `${pct(rmseGain)} lower than raw` : `raw: ${mm(raw.rmse)}`}</small></Reveal>
        <Reveal className="kpi card" delay={0.1}><span>Critical success index</span><strong><CountUp value={ours.csi ?? 0} format={(n) => n.toFixed(3)} /></strong><small>raw: {fixed(raw.csi, 3)} · higher is better</small></Reveal>
        <Reveal className="kpi card" delay={0.15}><span>Heavy-rain events</span><strong><CountUp value={ours.hits + ours.misses} /></strong><small>in this subset</small></Reveal>
      </div>

      <div className="grid-2">
        <ChartCard title="Event skill" description={`Higher is better · ≥ ${threshold} mm`} legend={<LegendRow items={MODELS.map((m) => ({ label: modelLabel[m], color: colors[m] }))} />}>
          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            <BarChart data={skill} barGap={2} barCategoryGap="26%">
              <CartesianGrid vertical={false} stroke={ct.grid} />
              <XAxis dataKey="name" tick={ct.tick} axisLine={{ stroke: ct.grid }} tickLine={false} />
              <YAxis domain={[0, 1]} tick={ct.tick} axisLine={false} tickLine={false} width={36} />
              <Tooltip cursor={{ fill: ct.cursor }} content={<ChartTooltip />} />
              {MODELS.map((m) => <RBar key={m} dataKey={modelLabel[m]} fill={colors[m]} radius={[4, 4, 0, 0]} maxBarSize={30} />)}
            </BarChart>
          </ResponsiveContainer>
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
        <ChartCard title="Probability reliability" description={`Forecast chance vs. how often ≥ ${threshold} mm actually happened`}
          legend={<LegendRow items={[{ label: 'MonsoonLens', color: colors['Regime-aware'] }, { label: 'Perfect', color: ct.axis, dashed: true }]} />}>
          <ResponsiveContainer width="100%" height="100%" minHeight={280}>
            <LineChart data={v.reliability[threshold]} margin={{ right: 12 }}>
              <CartesianGrid stroke={ct.grid} />
              <XAxis dataKey="forecast" type="number" domain={[0, 1]} tickFormatter={pct} tick={ct.tick} axisLine={{ stroke: ct.grid }} tickLine={false} />
              <YAxis domain={[0, 1]} tickFormatter={pct} tick={ct.tick} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip format={pct} labelFormat={(l) => `Forecast ${pct(Number(l))}`} />} />
              <Line name="Perfect" dataKey="forecast" stroke={ct.axis} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line name="Observed" type="monotone" dataKey="observed" stroke={colors['Regime-aware']} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="card pad">
          <h3>Outcome counts</h3>
          <p className="muted small">MonsoonLens · ≥ {threshold} mm</p>
          <div className="contingency">
            <div><span>Hits</span><strong className="num">{ours.hits.toLocaleString('en-IN')}</strong><small>forecast & observed</small></div>
            <div><span>Misses</span><strong className="num">{ours.misses.toLocaleString('en-IN')}</strong><small>observed, not forecast</small></div>
            <div><span>False alarms</span><strong className="num">{ours.false_alarms.toLocaleString('en-IN')}</strong><small>forecast, not observed</small></div>
            <div><span>Correct negatives</span><strong className="num">{ours.correct_negatives.toLocaleString('en-IN')}</strong><small>neither</small></div>
          </div>
        </div>
      </div>

      <Section title="The verification gate" description="A regime’s correction is served only if RMSE and heavy-rain CSI both improve on the raw and global baselines, with a positive lower 95% bootstrap bound.">
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
