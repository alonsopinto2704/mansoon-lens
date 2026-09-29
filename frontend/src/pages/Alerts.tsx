import { useMemo, useState } from 'react';
import { ChevronRight, Download, Search } from 'lucide-react';
import { useForecast } from '../data';
import { escapeHtml, formatDate, mm, pct, probColor, probLabels, probLegend, regimeColor, type District, type Forecast } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { IndiaMap } from '../components/IndiaMap';
import { DateLeadControls, Field, SourceNote, Toolbar } from '../components/Controls';
import { Bar, Empty, ErrorState, GateChip, LoadingBlock, PageHeader, Segmented } from '../components/ui';

const thresholds = [
  { value: '64.5', label: 'Heavy', key: 'prob_64_5' },
  { value: '115.6', label: 'Very heavy', key: 'prob_115_6' },
  { value: '204.5', label: 'Extremely heavy', key: 'prob_204_5' },
] as const;
type Threshold = (typeof thresholds)[number]['value'];

function exportCsv(rows: Forecast[], key: (typeof thresholds)[number]['key'], name: string) {
  const esc = (v: string | number) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  const lines = [['district', 'state', 'probability', 'served_mm', 'raw_mm', 'regime', 'correction'].join(',')]
    .concat(rows.map((r) => [r.district, r.state, r[key].toFixed(3), r.served_mm.toFixed(1), r.raw_mm.toFixed(1), r.dominant_regime, r.gate_status].map(esc).join(',')));
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // some browsers cancel if revoked immediately
}

export default function AlertsPage() {
  const theme = useResolvedTheme();
  const { lead, source } = useForecastStore();
  const [threshold, setThreshold] = useState<Threshold>('64.5');
  const [min, setMin] = useState('0.3');
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const forecast = useForecast();
  const all: Forecast[] = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const date = forecast.data?.date ?? '';
  const t = thresholds.find((x) => x.value === threshold)!;
  const states = useMemo(() => [...new Set(all.map((i) => i.state))].sort(), [all]);
  const items = useMemo(
    () => all.filter((i) => i[t.key] >= Number(min) && (!state || i.state === state) && `${i.district} ${i.state}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b[t.key] - a[t.key]),
    [all, t.key, min, state, search],
  );
  const current = all.find((i) => i.district_id === selected);
  const high = items.filter((i) => i[t.key] >= 0.6).length;
  const liveError = !all.length && forecast.data && 'status' in forecast.data && forecast.data.status === 'error' ? new Error(forecast.data.error || 'The live forecast is unavailable. Try again or switch to Verified season.') : null;
  const loading = forecast.isPending || (!all.length && forecast.data && 'status' in forecast.data && (forecast.data.status === 'fetching' || forecast.data.status === 'idle'));
  const ready = Boolean(forecast.data) && !loading && !forecast.isError && !liveError;
  const hasFilters = threshold !== '64.5' || min !== '0.3' || Boolean(state) || Boolean(search);
  const resetFilters = () => { setThreshold('64.5'); setMin('0.3'); setState(''); setSearch(''); };
  const retry = () => { void forecast.refetch(); };
  const feedback = forecast.isError || liveError ? <ErrorState error={forecast.error || liveError} onRetry={retry} />
    : loading ? <LoadingBlock rows={6} label="Loading district alerts" />
    : !all.length ? <Empty title="No forecasts available">Try another date or data source. <button className="btn btn-secondary" onClick={retry}>Try again</button></Empty>
    : <Empty title="No districts match these filters">Try a different district, lower the minimum chance, or reset your filters. <button className="btn btn-secondary" onClick={resetFilters}>Reset filters</button></Empty>;

  return (
    <div className="page">
      <PageHeader title="Heavy-rain alerts" description={`Districts ranked by their chance of crossing an IMD rainfall threshold${date ? ` · ${formatDate(date)}` : ''}.`}
        actions={<button className="btn btn-secondary" disabled={!ready || !items.length} onClick={() => exportCsv(items, t.key, `monsoonlens-alerts-${date}-d${lead}.csv`)}><Download size={16} aria-hidden /> Export CSV</button>} />

      <Toolbar>
        <DateLeadControls />
        <Field label="Threshold">
          <Segmented id="threshold" label="Rainfall threshold" value={threshold} onChange={setThreshold} options={thresholds.map(({ value, label }) => ({ value, label }))} />
        </Field>
        <Field label="Minimum chance">
          <select className="input" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum probability">
            {['0', '0.1', '0.3', '0.5', '0.7'].map((p) => <option value={p} key={p}>{p === '0' ? 'Any' : `${pct(Number(p))} or more`}</option>)}
          </select>
        </Field>
        <Field label="State">
          <select className="input" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">All states</option>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Find a district">
          <label className="input input-icon">
            <Search size={16} aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="District or state" aria-label="Search alerts by district or state" />
          </label>
        </Field>
        {hasFilters && <button className="btn btn-secondary" onClick={resetFilters}>Reset filters</button>}
      </Toolbar>
      <SourceNote />

      <div className="summary-row alert-summary" aria-live="polite">
        <div className="summary"><span>Matching districts</span><strong className="num">{ready ? items.length : '—'}</strong></div>
        <div className={`summary${high ? ' summary-alert' : ''}`}><span>Chance of 60% or more</span><strong className="num">{ready ? high : '—'}</strong></div>
        <div className="summary"><span>Highest matching chance</span><strong className="num">{ready && items.length ? pct(items[0][t.key]) : '—'}</strong></div>
        <div className="summary"><span>Selected threshold · 24 hours</span><strong className="num">≥ {threshold} mm</strong></div>
      </div>

      <div className="card map-card alerts-map">
        {ready && all.length ? (
          <div className="map-wrap">
            <IndiaMap items={all} selected={selected} onSelect={setSelected}
              color={(i) => probColor(i[t.key], theme)}
              tooltip={(i) => `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>${t.label} rain chance</span><b>${pct(i[t.key])}</b><span>Served</span><b>${mm(i.served_mm)}</b></div>`} />
            <div className="map-legend">
              <span className="label">Chance of ≥ {threshold} mm</span>
              <ul className="legend-keys">{probLegend(theme).map((c, k) => <li key={c}><i style={{ background: c }} />{probLabels[k]}</li>)}</ul>
            </div>
          </div>
        ) : <div className="pad">{feedback}</div>}
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>{ready ? `${items.length} district${items.length === 1 ? '' : 's'}` : 'Districts'}</h2>
            <p className="muted small">≥ {threshold} mm in 24 h · Ranked by chance, highest first. The map shows every district; the table and export use your filters.</p>
          </div>
        </div>
        {!ready || !items.length ? <div className="pad">{feedback}</div> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>District</th><th>Chance</th><th>Served rainfall</th><th>Regime</th><th>Correction</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {items.slice(0, 300).map((i) => (
                  <tr key={i.district_id} className="row-link" onClick={() => setSelected(i.district_id)}>
                    <td><strong>{i.district}</strong><small className="muted block">{i.state}</small></td>
                    <td><div className="prob-cell"><Bar value={i[t.key]} color={i[t.key] >= 0.6 ? 'var(--danger)' : i[t.key] >= 0.3 ? 'var(--warn)' : 'var(--text-3)'} /><b className="num">{pct(i[t.key])}</b></div></td>
                    <td className="num">{mm(i.served_mm)}</td>
                    <td><span className="regime-tag"><i style={{ background: regimeColor(i.dominant_regime, theme) }} />{i.dominant_regime}</span></td>
                    <td><GateChip status={i.gate_status} /></td>
                    <td className="align-right"><button className="icon-btn" aria-label={`Details for ${i.district}`} onClick={(e) => { e.stopPropagation(); setSelected(i.district_id); }}><ChevronRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > 300 && <p className="pad-sm muted small">Showing the top 300 — narrow by state or raise the minimum chance. Export includes all {items.length}.</p>}
          </div>
        )}
      </div>
      <p className="footnote">Not an official warning. For real warnings, follow the India Meteorological Department.</p>

      <DistrictDrawer id={selected} name={current?.district} state={current?.state} date={date} lead={lead} live={source === 'live' ? (current as District | undefined) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
