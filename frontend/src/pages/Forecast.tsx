import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useForecast } from '../data';
import { diffColor, diffLegend, escapeHtml, formatDate, mm, pct, probColor, probLabels, probLegend, rainBand, rainBands, rainColor, rainLegend, regimeColor, REGIMES, type District, type Forecast, type Theme } from '../lib';
import { useForecastStore, useResolvedTheme, type Layer } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { IndiaMap } from '../components/IndiaMap';
import { DateLeadControls, Field, SourceNote, Toolbar } from '../components/Controls';
import { Empty, ErrorState, LoadingBlock, PageHeader, Segmented, Skeleton } from '../components/ui';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} mm`;

/** Everything a map layer needs: its value, colour, text and legend. */
const layers: Record<Layer, { label: string; legend: string; value: (i: Forecast) => number; text: (i: Forecast) => string; color: (i: Forecast, t: Theme) => string; keys: (t: Theme) => { color: string; label: string }[] }> = {
  corrected: {
    label: 'Served', legend: 'Served rainfall · IMD category', value: (i) => i.served_mm, text: (i) => mm(i.served_mm),
    color: (i, t) => rainColor(i.served_mm, t), keys: (t) => rainLegend(t).map((color, k) => ({ color, label: rainBands[k].label })),
  },
  raw: {
    label: 'Raw model', legend: 'Raw NWP rainfall · IMD category', value: (i) => i.raw_mm, text: (i) => mm(i.raw_mm),
    color: (i, t) => rainColor(i.raw_mm, t), keys: (t) => rainLegend(t).map((color, k) => ({ color, label: rainBands[k].label })),
  },
  observed: {
    label: 'Observed', legend: 'Observed rainfall (held-out truth)', value: (i) => i.observed_mm ?? 0, text: (i) => (i.observed_mm === null ? '—' : mm(i.observed_mm)),
    color: (i, t) => rainColor(i.observed_mm ?? 0, t), keys: (t) => rainLegend(t).map((color, k) => ({ color, label: rainBands[k].label })),
  },
  diff: {
    label: 'Change', legend: 'Served minus raw', value: (i) => i.served_mm - i.raw_mm, text: (i) => signed(i.served_mm - i.raw_mm),
    color: (i, t) => diffColor(i.served_mm - i.raw_mm, t),
    keys: (t) => diffLegend(t).map((color, k) => ({ color, label: ['≤ −15', '−15 to −3', '±3', '3 to 15', '≥ 15'][k] })),
  },
  probability: {
    label: 'Heavy-rain chance', legend: 'Chance of ≥ 64.5 mm', value: (i) => i.prob_64_5, text: (i) => pct(i.prob_64_5),
    color: (i, t) => probColor(i.prob_64_5, t), keys: (t) => probLegend(t).map((color, k) => ({ color, label: probLabels[k] })),
  },
  regime: {
    label: 'Regime', legend: 'Most likely weather regime', value: (i) => REGIMES.length - REGIMES.indexOf(i.dominant_regime), text: (i) => i.dominant_regime,
    color: (i, t) => regimeColor(i.dominant_regime, t), keys: (t) => REGIMES.map((r) => ({ color: regimeColor(r, t), label: r })),
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
  const { source, lead, layer, setLayer } = useForecastStore();
  const isLive = source === 'live';
  const shownLayers = (Object.keys(layers) as Layer[]).filter((l) => !(isLive && l === 'observed'));
  const forecast = useForecast();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const items: Forecast[] = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const date = forecast.data?.date ?? '';
  const liveStatus = forecast.data && 'status' in forecast.data ? forecast.data.status : undefined;
  const loading = forecast.isPending || (!items.length && (liveStatus === 'fetching' || liveStatus === 'idle'));
  const error = forecast.isError ? forecast.error : liveStatus === 'error' && !items.length ? new Error(('error' in forecast.data! && forecast.data.error) || 'The live forecast is unavailable.') : null;
  const L = layers[layer];
  const isRainLayer = layer === 'corrected' || layer === 'raw' || layer === 'observed';
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? items.filter((i) => `${i.district} ${i.state}`.toLowerCase().includes(q)) : items;
    return [...rows].sort((a, b) => Math.abs(L.value(b)) - Math.abs(L.value(a)));
  }, [items, search, L]);
  const current = items.find((i) => i.district_id === selected);
  const heavy = items.filter((i) => i.served_mm >= 64.5).length;
  const likely = items.filter((i) => i.prob_64_5 >= 0.5).length;
  const corrected = items.filter((i) => i.gate_status === 'Corrected').length;
  const color = (i: Forecast) => L.color(i, theme);
  const tooltip = (i: Forecast) =>
    `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>Served</span><b>${mm(i.served_mm)}</b><span>Raw</span><b>${mm(i.raw_mm)}</b><span>Heavy-rain chance</span><b>${pct(i.prob_64_5)}</b><span>Regime</span><b>${escapeHtml(i.dominant_regime)}</b></div>`;

  return (
    <div className="page">
      <PageHeader title="District forecast" description={`${date ? formatDate(date) : loading ? 'Loading forecast' : 'Forecast unavailable'} · Day +${lead}. Point at a district for its numbers; select it for the full breakdown.`} />

      <Toolbar>
        <DateLeadControls />
        <Field label="Map layer">
          <Segmented id="layer" label="Map layer" value={layer} onChange={setLayer}
            options={shownLayers.map((value) => ({ value, label: layers[value].label }))} />
        </Field>
      </Toolbar>
      <SourceNote />

      <div className="summary-row">
        <div className="summary"><span>Districts</span><strong className="num">{forecast.data ? items.length : '—'}</strong></div>
        <div className={`summary${heavy ? " summary-alert" : ""}`}><span>Heavy rain served (≥ 64.5 mm)</span><strong className="num">{forecast.data ? heavy : '—'}</strong></div>
        <div className="summary"><span>Heavy-rain chance ≥ 50%</span><strong className="num">{forecast.data ? likely : '—'}</strong></div>
        <div className="summary"><span>Serving corrected</span><strong className="num">{forecast.data ? `${corrected}` : '—'}</strong></div>
      </div>

      <div className="map-layout">
        <div className="map-card card">
          {error ? <div className="pad"><ErrorState error={error} onRetry={() => forecast.refetch()} /></div> : loading ? <div className="pad"><LoadingBlock rows={8} label={isLive ? 'Fetching the live forecast' : 'Loading district forecasts'} /></div> : !items.length ? <div className="pad"><Empty title="No forecasts available">Choose another date or lead time, or switch the data source.</Empty><button className="btn btn-secondary mt" onClick={() => forecast.refetch()}>Try again</button></div> : (
            <div className="map-wrap">
              <IndiaMap items={items} color={color} tooltip={tooltip} selected={selected} onSelect={setSelected} />
              <Legend layer={layer} />
            </div>
          )}
        </div>

        <aside className="list-card card" aria-label="Districts">
          <div className="list-head">
            <div className="input input-icon">
              <Search size={16} aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search district or state" aria-label="Search district or state" />
              {search && <button className="icon-btn" onClick={() => setSearch('')} aria-label="Clear district search"><X size={14} aria-hidden /></button>}
            </div>
            <span className="muted small" role="status">{loading ? 'Loading districts…' : error ? 'Districts unavailable' : `${list.length} districts · sorted by ${L.label.toLowerCase()}`}</span>
          </div>
          <ul className="district-list">
            {!error && loading && Array.from({ length: 8 }, (_, i) => <li key={i} className="pad-sm"><Skeleton height={34} /></li>)}
            {error && <li className="pad"><Empty title="District list unavailable">Use Try again on the map to reload this forecast.</Empty></li>}
            {!error && list.slice(0, 200).map((item) => (
              <li key={item.district_id}>
                <button className={selected === item.district_id ? 'is-selected' : ''} onClick={() => setSelected(item.district_id)}>
                  <span className="swatch" style={{ background: color(item) }} />
                  <span className="district-name"><strong>{item.district}</strong><small>{item.state} · {isRainLayer ? rainBands[rainBand(L.value(item))].label : item.dominant_regime}</small></span>
                  <b className="num">{L.text(item)}</b>
                </button>
              </li>
            ))}
            {!error && !loading && list.length === 0 && <li className="pad"><Empty title={search ? 'No matching district' : 'No districts available'}>{search ? 'Try a different name or state.' : 'Choose another date, lead time or data source.'}</Empty>{search && <button className="btn btn-secondary mt" onClick={() => setSearch('')}>Clear search</button>}</li>}
            {list.length > 200 && <li className="pad-sm muted small">Showing top 200 — search to find others.</li>}
          </ul>
        </aside>
      </div>

      <DistrictDrawer id={current ? selected : null} name={current?.district} state={current?.state} date={date} lead={lead} live={isLive ? (current as District | undefined) : undefined} onClose={() => setSelected(null)} />
    </div>
  );
}
