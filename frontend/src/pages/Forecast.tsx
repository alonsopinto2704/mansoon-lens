import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useForecast } from '../data';
import {
  noObservationColor, observationColor, diffColor, diffIndex, diffLegend, diffLabels, escapeHtml, LEVELS, mm, pct, probColor, probLabels, probLegend, rainBand, rainBands, rainColor, rainLegend,
  levelFill, regimeColor, REGIMES, titleDate, warningLevel, type District, type Forecast, type Theme,
} from '../lib';
import { useForecastStore, useResolvedTheme, withForecastView, type Layer } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { IndiaMap } from '../components/IndiaMap';
import { DayStrip, SourceControls, SourceNote } from '../components/Controls';
import { CountUp, Empty, ErrorState, LoadingBlock, Segmented, Skeleton } from '../components/ui';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} mm`;

type LayerSpec = { label: string; legend: string; value: (i: Forecast) => number; text: (i: Forecast) => string; color: (i: Forecast, t: Theme) => string; keys: (t: Theme) => { color: string; label: string }[]; detail: (i: Forecast) => string };
const rainKeys = (t: Theme) => rainLegend(t).map((color, k) => ({ color, label: rainBands[k].label }));

/** Everything a map layer needs: its value, colour, text and legend. */
const layers: Record<Layer, LayerSpec> = {
  corrected: { label: 'Served', legend: 'Served rainfall', value: (i) => i.served_mm, text: (i) => mm(i.served_mm), color: (i, t) => rainColor(i.served_mm, t), keys: rainKeys, detail: (i) => rainBands[rainBand(i.served_mm)].label },
  warning: {
    label: 'Warning level', legend: 'Colour code (derived)', value: (i) => LEVELS.indexOf(warningLevel(i)) + i.prob_64_5, text: (i) => warningLevel(i).name,
    color: (i, t) => levelFill(warningLevel(i), t), keys: (t) => [...LEVELS].reverse().map((l) => ({ color: levelFill(l, t), label: `${l.name} · ${l.action}` })), detail: (i) => warningLevel(i).action,
  },
  probability: {
    label: 'Heavy-rain chance', legend: 'Chance of ≥ 64.5 mm', value: (i) => i.prob_64_5, text: (i) => pct(i.prob_64_5),
    color: (i, t) => probColor(i.prob_64_5, t), keys: (t) => probLegend(t).map((color, k) => ({ color, label: probLabels[k] })), detail: (i) => warningLevel(i).action,
  },
  raw: { label: 'Raw model', legend: 'Raw NWP rainfall', value: (i) => i.raw_mm, text: (i) => mm(i.raw_mm), color: (i, t) => rainColor(i.raw_mm, t), keys: rainKeys, detail: (i) => rainBands[rainBand(i.raw_mm)].label },
  diff: {
    label: 'Change', legend: 'Served minus raw (mm)', value: (i) => i.served_mm - i.raw_mm, text: (i) => signed(i.served_mm - i.raw_mm),
    color: (i, t) => diffColor(i.served_mm - i.raw_mm, t), keys: (t) => diffLegend(t).map((color, k) => ({ color, label: diffLabels[k] })), detail: (i) => diffLabels[diffIndex(i.served_mm - i.raw_mm)].toLowerCase(),
  },
  observed: {
    label: 'Observed', legend: 'Observed rainfall', value: (i) => i.observed_mm ?? 0, text: (i) => (i.observed_mm === null ? '—' : mm(i.observed_mm)),
    color: (i, t) => observationColor(i.observed_mm, t), keys: (t) => [...rainKeys(t), { color: noObservationColor(t), label: 'No observation' }], detail: (i) => (i.observed_mm === null ? 'no observation' : rainBands[rainBand(i.observed_mm ?? 0)].label),
  },
  regime: {
    label: 'Regime', legend: 'Most likely weather regime', value: (i) => REGIMES.length - REGIMES.indexOf(i.dominant_regime), text: (i) => i.dominant_regime,
    color: (i, t) => regimeColor(i.dominant_regime, t), keys: (t) => REGIMES.map((r) => ({ color: regimeColor(r, t), label: r })), detail: (i) => i.dominant_regime,
  },
};

function Legend({ layer }: { layer: Layer }) {
  const theme = useResolvedTheme();
  return (
    <div className="map-legend">
      <span className="label">{layers[layer].legend}</span>
      <ul className="legend-keys">
        {layers[layer].keys(theme).map((k) => <li key={k.label}><i style={{ background: k.color }} />{k.label}</li>)}
      </ul>
    </div>
  );
}

export default function ForecastPage() {
  const theme = useResolvedTheme();
  const { source, lead, layer, setLayer, setLead } = useForecastStore();
  const isLive = source === 'live';
  const shownLayers = (Object.keys(layers) as Layer[]).filter((l) => !(isLive && l === 'observed'));
  const forecast = useForecast();
  // ?district=<id> deep-links to a district (the home page search and shared links use it).
  const [params, setParams] = useSearchParams();
  const selected = params.get('district');
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('district', id); else next.delete('district');
    setParams(withForecastView(next), { replace: true });
  };
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  // [ / ] step the live lead day; ignored while typing or with modifiers.
  useEffect(() => {
    if (source !== 'live') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== '[' && e.key !== ']') || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]'))) return;
      setLead(Math.min(5, Math.max(1, lead + (e.key === ']' ? 1 : -1))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, lead, setLead]);
  const items: Forecast[] = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const date = forecast.data?.date ?? '';
  const liveStatus = forecast.data && 'status' in forecast.data ? forecast.data.status : undefined;
  const loading = forecast.isPending || (!items.length && (liveStatus === 'fetching' || liveStatus === 'idle'));
  const error = forecast.isError ? forecast.error : liveStatus === 'error' && !items.length ? new Error(('error' in forecast.data! && forecast.data.error) || 'The live forecast is unavailable.') : null;
  const L = layers[layer];
  const list = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const rows = q ? items.filter((i) => `${i.district} ${i.state}`.toLowerCase().includes(q)) : items;
    return [...rows].sort((a, b) => layer === 'observed' && (a.observed_mm === null || b.observed_mm === null) ? Number(a.observed_mm === null) - Number(b.observed_mm === null) : Math.abs(L.value(b)) - Math.abs(L.value(a)));
  }, [items, deferredSearch, L, layer]);
  const current = items.find((i) => i.district_id === selected);
  const stats = useMemo(() => ({
    heavy: items.filter((i) => i.served_mm >= 64.5).length,
    likely: items.filter((i) => i.prob_64_5 >= 0.5).length,
    alerts: items.filter((i) => ['orange', 'red'].includes(warningLevel(i).key)).length,
    corrected: items.filter((i) => i.gate_status === 'Corrected').length,
    wettest: items.reduce<Forecast | null>((w, i) => (!w || i.served_mm > w.served_mm ? i : w), null),
  }), [items]);
  const color = useCallback((i: Forecast) => L.color(i, theme), [L, theme]);
  const tooltip = useCallback((i: Forecast) => {
    const level = warningLevel(i);
    return `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>${escapeHtml(L.legend)}</span><b>${escapeHtml(L.text(i))}</b><span>Served</span><b>${mm(i.served_mm)}</b><span>Raw NWP</span><b>${mm(i.raw_mm)}</b><span>Heavy-rain chance</span><b>${pct(i.prob_64_5)}</b><span>Warning level</span><b><i class="tip-dot" style="background:${level.color}"></i>${level.name}</b><span>Regime</span><b>${escapeHtml(i.dominant_regime)}</b></div>`;
  }, [L]);

  return (
    <div className="page page-wide">
      <header className="ws-head">
        <div>
          <span className="label">District forecast · {isLive ? 'live NWP, corrected' : 'held-out season'}</span>
          <h1 className="ws-title">{date ? titleDate(date, !(isLive)) : loading ? 'Loading forecast…' : 'Forecast unavailable'}</h1>
        </div>
        <SourceControls />
      </header>

      <DayStrip />

      <div className="ws-stats" aria-live="polite">
        <span><b>{forecast.data ? <CountUp value={items.length} /> : '—'}</b> districts</span>
        <span className={stats.alerts ? 'is-hot' : ''}><b>{forecast.data ? <CountUp value={stats.alerts} /> : '—'}</b> at orange or red</span>
        <span><b>{forecast.data ? <CountUp value={stats.heavy} /> : '—'}</b> with ≥ 64.5 mm served</span>
        <span><b>{forecast.data ? <CountUp value={stats.likely} /> : '—'}</b> with ≥ 50% heavy-rain chance</span>
        <span><b>{forecast.data ? <CountUp value={stats.corrected} /> : '—'}</b> serving the correction</span>
        {stats.wettest && <span className="ws-wettest">Wettest: <button className="link" onClick={() => setSelected(stats.wettest!.district_id)}>{stats.wettest.district}</button> <b className="num">{mm(stats.wettest.served_mm)}</b></span>}
      </div>

      <div className="map-layout">
        <div className="map-card card">
          {error ? <div className="pad"><ErrorState error={error} onRetry={() => forecast.refetch()} /></div> : loading ? <div className="pad"><LoadingBlock rows={8} label={isLive ? 'Fetching the live forecast' : 'Loading district forecasts'} /></div> : !items.length ? <div className="pad"><Empty title="No forecasts available">Choose another day or switch the data source.</Empty><button className="btn btn-secondary mt" onClick={() => forecast.refetch()}>Try again</button></div> : (
            <div className="map-wrap">
              <IndiaMap items={items} color={color} tooltip={tooltip} selected={selected} onSelect={setSelected} />
              <div className="map-layers">
                <Segmented id="layer" label="Map layer" value={layer} onChange={setLayer} options={shownLayers.map((value) => ({ value, label: layers[value].label }))} />
                <select className="input map-layer-select" aria-label="Map layer" value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
                  {shownLayers.map((value) => <option key={value} value={value}>{layers[value].label}</option>)}
                </select>
              </div>
              <Legend layer={layer} />
            </div>
          )}
        </div>

        <aside className="list-card card" aria-label="Districts">
          <div className="list-head">
            <div className="input input-icon">
              <Search size={16} aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search district or state" aria-label="Search district or state" />
              {search && <button className="icon-btn icon-btn-sm" onClick={() => setSearch('')} aria-label="Clear district search"><X size={14} aria-hidden /></button>}
            </div>
            <span className="muted small" role="status" aria-live="polite">{loading ? 'Loading districts…' : error ? 'Districts unavailable' : `${list.length} districts · ranked by ${L.label.toLowerCase()}`}</span>
          </div>
          <ul className="district-list">
            {!error && loading && Array.from({ length: 8 }, (_, i) => <li key={i} className="pad-sm"><Skeleton height={34} /></li>)}
            {error && <li className="pad"><Empty title="District list unavailable">Use Try again on the map to reload this forecast.</Empty></li>}
            {!error && list.slice(0, 200).map((item, rank) => (
              <li key={item.district_id}>
                <button className={selected === item.district_id ? 'is-selected' : ''} onClick={() => setSelected(item.district_id)}>
                  <span className="rank num">{rank + 1}</span>
                  <span className="swatch" style={{ background: color(item) }} />
                  <span className="district-name"><strong>{item.district}</strong><small>{item.state} · {L.detail(item)}</small></span>
                  <b className="num">{L.text(item)}</b>
                </button>
              </li>
            ))}
            {!error && !loading && list.length === 0 && <li className="pad"><Empty title={search ? 'No matching district' : 'No districts available'}>{search ? 'Try a different name or state.' : 'Choose another day or data source.'}</Empty>{search && <button className="btn btn-secondary mt" onClick={() => setSearch('')}>Clear search</button>}</li>}
            {list.length > 200 && <li className="pad-sm muted small">Showing the top 200 — search to find others.</li>}
          </ul>
        </aside>
      </div>
      <SourceNote />

      <DistrictDrawer id={current ? selected : null} name={current?.district} state={current?.state} date={date} lead={lead} live={isLive ? (current as District | undefined) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
