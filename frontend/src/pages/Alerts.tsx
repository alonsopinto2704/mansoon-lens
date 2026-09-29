import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Download, Search } from 'lucide-react';
import { m } from 'motion/react';
import { useForecast } from '../data';
import { alertsCsv, compareAlerts, stateSummary, escapeHtml, levelFill, LEVELS, mm, pct, probColor, probLabels, probLegend, regimeColor, titleDate, warningLevel, type District, type Forecast, type Level } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { IndiaMap } from '../components/IndiaMap';
import { DayStrip, SourceControls, SourceNote } from '../components/Controls';
import { Bar, CountUp, Empty, ErrorState, GateChip, LevelChip, LoadingBlock, Segmented } from '../components/ui';

const thresholds = [
  { value: '64.5', label: 'Heavy', key: 'prob_64_5' },
  { value: '115.6', label: 'Very heavy', key: 'prob_115_6' },
  { value: '204.5', label: 'Extremely heavy', key: 'prob_204_5' },
] as const;
type Threshold = (typeof thresholds)[number]['value'];
type LevelFilter = 'yellow' | 'orange' | 'red' | 'all';
const rankOf = (l: Level) => LEVELS.indexOf(l);
const minRank: Record<LevelFilter, number> = { all: 0, yellow: 1, orange: 2, red: 3 };

function exportCsv(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
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
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('yellow');
  const [mapMode, setMapMode] = useState<'level' | 'chance'>('level');
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  // Selected district is mirrored to ?district= so the drawer's copy-link button shares a deep link.
  const [params, setParams] = useSearchParams();
  const selected = params.get('district');
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('district', id); else next.delete('district');
    setParams(next, { replace: true });
  };
  const forecast = useForecast();
  const all: Forecast[] = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const date = forecast.data?.date ?? '';
  const t = thresholds.find((x) => x.value === threshold)!;
  const states = useMemo(() => [...new Set(all.map((i) => i.state))].sort(), [all]);
  const counts = useMemo(() => LEVELS.map((l) => all.filter((i) => warningLevel(i).key === l.key).length), [all]);
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((i) => rankOf(warningLevel(i)) >= minRank[levelFilter] && (!state || i.state === state) && `${i.district} ${i.state}`.toLowerCase().includes(q))
      .sort((a, b) => compareAlerts(a, b, t.key, levelFilter === 'all'));
  }, [all, t.key, levelFilter, state, search]);
  const top = useMemo(() => all.reduce<Forecast | null>((w, i) => (!w || i[t.key] > w[t.key] ? i : w), null), [all, t.key]);
  // warningLevel per row, computed once per item for the table render and export.
  const levels = useMemo(() => new Map(all.map((i) => [i.district_id, warningLevel(i)])), [all]);
  const current = all.find((i) => i.district_id === selected);
  const byState = useMemo(() => stateSummary(all), [all]);
  const liveError = !all.length && forecast.data && 'status' in forecast.data && forecast.data.status === 'error' ? new Error(forecast.data.error || 'The live forecast is unavailable. Try again or switch to Verified season.') : null;
  const loading = forecast.isPending || (!all.length && forecast.data && 'status' in forecast.data && (forecast.data.status === 'fetching' || forecast.data.status === 'idle'));
  const ready = Boolean(forecast.data) && !loading && !forecast.isError && !liveError;
  const hasFilters = levelFilter !== 'yellow' || Boolean(state) || Boolean(search);
  const resetFilters = () => { setLevelFilter('yellow'); setState(''); setSearch(''); };
  const retry = () => { void forecast.refetch(); };
  const quiet = ready && !items.length && !state && !search && levelFilter === 'yellow';
  const feedback = forecast.isError || liveError ? <ErrorState error={forecast.error || liveError} onRetry={retry} />
    : loading ? <LoadingBlock rows={6} label="Loading district alerts" />
    : !all.length ? <Empty title="No forecasts available">Try another day or data source. <button className="btn btn-secondary" onClick={retry}>Try again</button></Empty>
    : quiet ? (
      <div className="quiet">
        <span className="quiet-mark" aria-hidden>✓</span>
        <div>
          <strong>No district reaches yellow{date ? ` on ${titleDate(date, !(source === 'live'))}` : ''}.</strong>
          <p>All {all.length} districts are green: none has a 30% or higher chance of ≥ 64.5 mm.{top ? <> The highest {t.label.toLowerCase()}-rain chance is <b>{pct(top[t.key])}</b> in <button className="link" onClick={() => setSelected(top.district_id)}>{top.district}</button>.</> : null}</p>
          <button className="btn btn-secondary mt" onClick={() => setLevelFilter('all')}>Show all districts ranked by chance</button>
        </div>
      </div>
    )
    : <Empty title="No districts match these filters">Try another level, state or name. <button className="btn btn-secondary" onClick={resetFilters}>Reset filters</button></Empty>;

  return (
    <div className="page page-wide">
      <header className="ws-head">
        <div>
          <span className="label">Heavy-rain alerts · IMD colour scheme</span>
          <h1 className="ws-title">{date ? titleDate(date, !(source === 'live')) : loading ? 'Loading alerts…' : 'Alerts unavailable'}</h1>
        </div>
        <div className="ws-actions">
          <SourceControls />
          <button className="btn btn-secondary" disabled={!ready || !items.length} onClick={() => exportCsv(alertsCsv(items, t.key, { date, lead, source: source === 'live' ? 'live_nwp_unverified_correction' : 'synthetic_2025', fetchedAt: forecast.data && 'fetched_at' in forecast.data ? forecast.data.fetched_at ?? '' : '' }), `monsoonlens-alerts-${source}-${date}-d${lead}-ge${threshold}mm.csv`)}><Download size={16} aria-hidden /> Export CSV</button>
        </div>
      </header>

      <DayStrip />

      <div className="level-tiles" role="group" aria-label="Districts by warning level">
        {[...LEVELS].reverse().map((l) => {
          const n = counts[rankOf(l)];
          const active = (l.key === 'orange' || l.key === 'red') && levelFilter === l.key; // yellow+ is the default, not a pick
          return (
            <button key={l.key} className={`level-tile level-${l.key}${active ? ' is-active' : ''}`} aria-pressed={active} disabled={l.key === 'green'}
              onClick={() => setLevelFilter(active ? 'yellow' : (l.key as LevelFilter))} title={l.key === 'green' ? undefined : `Show ${l.name.toLowerCase()} and above`}>
              <span className="level-bar" style={{ background: l.color }} />
              <span className="level-name">{l.name} · {l.label}</span>
              <strong className="num">{ready ? <CountUp value={n} /> : '—'}</strong>
              <span className="level-action">{l.action}</span>
            </button>
          );
        })}
      </div>

      <div className="alerts-grid">
        <div className="card map-card alerts-map">
          {ready && all.length ? (
            <div className="map-wrap">
              <IndiaMap items={all} selected={selected} onSelect={setSelected}
                color={(i) => (mapMode === 'level' ? levelFill(warningLevel(i), theme) : probColor(i[t.key], theme))}
                tooltip={(i) => { const l = warningLevel(i); return `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>Level</span><b><i class="tip-dot" style="background:${l.color}"></i>${l.name} · ${l.action}</b><span>${t.label} rain chance</span><b>${pct(i[t.key])}</b><span>Served</span><b>${mm(i.served_mm)}</b></div>`; }} />
              <div className="map-layers">
                <Segmented id="alert-map" label="Map shows" value={mapMode} onChange={setMapMode} options={[{ value: 'level', label: 'Warning level' }, { value: 'chance', label: `Chance ≥ ${threshold} mm` }]} />
              </div>
              <div className="map-legend">
                {mapMode === 'level' ? (
                  <><span className="label">Colour code (derived)</span>
                    <ul className="legend-keys">{[...LEVELS].reverse().map((l) => <li key={l.key}><i style={{ background: levelFill(l, theme) }} />{l.name} · {l.action}</li>)}</ul></>
                ) : (
                  <><span className="label">Chance of ≥ {threshold} mm</span>
                    <ul className="legend-keys">{probLegend(theme).map((c, k) => <li key={c}><i style={{ background: c }} />{probLabels[k]}</li>)}</ul></>
                )}
              </div>
            </div>
          ) : <div className="pad">{feedback}</div>}
        </div>

        <aside className="card rule-card">
          <span className="label">How the colour is set</span>
          <ul className="rule-list">
            <li><LevelChip level={LEVELS[3]} /> ≥ 50% chance of 115.6 mm, or ≥ 30% of 204.5 mm</li>
            <li><LevelChip level={LEVELS[2]} /> ≥ 60% chance of 64.5 mm, or ≥ 30% of 115.6 mm</li>
            <li><LevelChip level={LEVELS[1]} /> ≥ 30% chance of 64.5 mm</li>
            <li><LevelChip level={LEVELS[0]} /> otherwise</li>
          </ul>
          <p className="muted small">Derived from MonsoonLens heavy-rain probabilities using IMD’s green–yellow–orange–red scheme. Not an official warning: follow IMD district warnings.</p>
        </aside>
      </div>

      {ready && byState.length > 0 && (
        <div className="card table-card state-card">
          <div className="table-head">
            <h2>By state</h2>
            <p className="muted small">{byState.length} state{byState.length === 1 ? '' : 's'} with a yellow or higher district. Select a state to list its districts.</p>
          </div>
          <div className="table-scroll">
            <table className="table state-table">
              <thead><tr><th>State</th>{[...LEVELS].reverse().slice(0, 3).map((l) => <th key={l.key} className="align-right"><i className="tip-dot" style={{ background: l.color }} />{l.name}</th>)}<th className="align-right">Districts</th></tr></thead>
              <tbody>
                {byState.map((s) => (
                  <tr key={s.state} className={`row-link${state === s.state ? ' is-active' : ''}`} onClick={() => setState(state === s.state ? '' : s.state)}>
                    <th scope="row"><button className="link" aria-pressed={state === s.state}>{s.state}</button></th>
                    {[3, 2, 1].map((k) => <td key={k} className="align-right num">{s.counts[k] || <span className="muted">0</span>}</td>)}
                    <td className="align-right num muted">{s.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card table-card">
        <div className="table-head table-head-tools">
          <div>
            <h2>{ready ? `${items.length} district${items.length === 1 ? '' : 's'}` : 'Districts'}</h2>
            <p className="muted small">{levelFilter === 'all' ? 'Ranked by chance' : 'Ranked by level, then by chance'} of ≥ {threshold} mm in 24 h.</p>
          </div>
          <div className="table-tools">
            <Segmented id="level-filter" label="Minimum level" value={levelFilter} onChange={setLevelFilter}
              options={[{ value: 'yellow', label: 'Yellow +' }, { value: 'orange', label: 'Orange +' }, { value: 'red', label: 'Red' }, { value: 'all', label: 'All' }]} />
            <Segmented id="threshold" label="Rainfall threshold" value={threshold} onChange={setThreshold} options={thresholds.map(({ value }) => ({ value, label: `≥ ${value}` }))} />
            <select className="input" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
              <option value="">All states</option>
              {states.map((s) => <option key={s}>{s}</option>)}
            </select>
            <label className="input input-icon">
              <Search size={16} aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a district" aria-label="Search alerts by district or state" />
            </label>
            {hasFilters && <button className="btn btn-ghost" onClick={resetFilters}>Reset</button>}
          </div>
        </div>
        {!ready || !items.length ? <div className="pad">{feedback}</div> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Level</th><th>District</th><th>Chance ≥ {threshold} mm</th><th className="align-right">Served</th><th>Regime</th><th>Correction</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {items.slice(0, 300).map((i, n) => {
                  const l = levels.get(i.district_id) ?? warningLevel(i);
                  return (
                    <m.tr key={i.district_id} className="row-link" onClick={() => setSelected(i.district_id)}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: Math.min(n, 12) * 0.02 }}>
                      <td><LevelChip level={l} /></td>
                      <td><strong>{i.district}</strong><small className="muted block">{i.state}</small></td>
                      <td><div className="prob-cell"><Bar value={i[t.key]} color={probColor(Math.max(i[t.key], 0.3), theme)} /><b className="num">{pct(i[t.key])}</b></div></td>
                      <td className="num align-right">{mm(i.served_mm)}</td>
                      <td><span className="regime-tag"><i style={{ background: regimeColor(i.dominant_regime, theme) }} />{i.dominant_regime}</span></td>
                      <td><GateChip status={i.gate_status} /></td>
                      <td className="align-right"><button className="icon-btn" aria-label={`Details for ${i.district}`} onClick={(e) => { e.stopPropagation(); setSelected(i.district_id); }}><ChevronRight size={16} /></button></td>
                    </m.tr>
                  );
                })}
              </tbody>
            </table>
            {items.length > 300 && <p className="pad-sm muted small">Showing the top 300 — narrow by level or state. Export includes all {items.length}.</p>}
          </div>
        )}
      </div>
      <SourceNote />

      <DistrictDrawer id={current ? selected : null} name={current?.district} state={current?.state} date={date} lead={lead} live={source === 'live' ? (current as District | undefined) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
