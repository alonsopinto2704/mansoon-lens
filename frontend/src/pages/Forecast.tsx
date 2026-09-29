import { useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import { Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useForecast } from '../data';
import { diffColor, diffLegend, formatDate, mm, rainBands, rainColor, rainLegend } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { DateLeadControls, Field, Toolbar } from '../components/Controls';
import { Empty, ErrorState, PageHeader, Segmented, Skeleton } from '../components/ui';

const tiles = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

function Legend({ diff }: { diff: boolean }) {
  const theme = useResolvedTheme();
  const colors = diff ? diffLegend(theme) : rainLegend(theme);
  return (
    <div className="map-legend">
      <span className="label">{diff ? 'Correction vs raw (mm)' : 'Rainfall (mm/day)'}</span>
      <div className="legend-bar">{colors.map((c) => <span key={c} style={{ background: c }} />)}</div>
      <div className="legend-ticks">
        {diff ? <><span>Drier</span><span>No change</span><span>Wetter</span></> : <><span>0</span><span>64.5</span><span>204.5+</span></>}
      </div>
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} mm`;

export default function ForecastPage() {
  const theme = useResolvedTheme();
  const { date, lead, layer, setLayer } = useForecastStore();
  const forecast = useForecast(layer);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const items = useMemo(() => forecast.data?.items ?? [], [forecast.data]);
  const isDiff = layer === 'diff';
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? items.filter((i) => `${i.district} ${i.state}`.toLowerCase().includes(q)) : items;
    return [...rows].sort((a, b) => (isDiff ? Math.abs(b.value) - Math.abs(a.value) : b.value - a.value));
  }, [items, search, isDiff]);
  const current = items.find((i) => i.district_id === selected);
  const heavy = items.filter((i) => i.served_mm >= 64.5).length;
  const corrected = items.filter((i) => i.gate_status === 'Corrected').length;
  const color = (v: number) => (isDiff ? diffColor(v, theme) : rainColor(v, theme));

  return (
    <div className="page">
      <PageHeader title="Forecast map" description="District rainfall for the selected day. Click a district for its likely range, regime and heavy-rain chances." />

      <Toolbar>
        <DateLeadControls />
        <Field label="Show">
          <Segmented id="layer" label="Map layer" value={layer} onChange={setLayer}
            options={[{ value: 'corrected', label: 'Served' }, { value: 'raw', label: 'Raw model' }, { value: 'diff', label: 'Change' }]} />
        </Field>
      </Toolbar>

      <div className="summary-row">
        <div className="summary"><span>Districts</span><strong className="num">{forecast.data ? items.length : '—'}</strong></div>
        <div className="summary"><span>Heavy rain (≥ 64.5 mm)</span><strong className="num">{forecast.data ? heavy : '—'}</strong></div>
        <div className="summary"><span>Serving corrected</span><strong className="num">{forecast.data ? corrected : '—'}</strong></div>
        <div className="summary"><span>Valid</span><strong>{date ? formatDate(date) : '—'}</strong></div>
      </div>

      <div className="map-layout">
        <div className="map-card card">
          {forecast.isError ? <div className="pad"><ErrorState error={forecast.error} /></div> : !forecast.data ? <Skeleton height="100%" className="map-skeleton" /> : !items.length ? <div className="pad"><Empty title="No forecasts for this date" /></div> : (
            <div className="map-wrap">
              <MapContainer center={[22.5, 81]} zoom={5} minZoom={4} maxZoom={9} scrollWheelZoom={false} className="leaflet-map">
                <TileLayer key={theme} url={tiles[theme]} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' />
                {items.map((item) => {
                  const isSel = selected === item.district_id;
                  return (
                    <CircleMarker key={item.district_id} center={[item.lat, item.lon]} radius={isSel ? 11 : 7}
                      pathOptions={{ color: isSel ? 'var(--text)' : 'var(--map-stroke)', weight: isSel ? 2.5 : 1, fillColor: color(item.value), fillOpacity: 0.95 }}
                      eventHandlers={{ click: () => setSelected(item.district_id) }}>
                      <Tooltip direction="top" offset={[0, -6]}><strong>{item.district}</strong> · {item.state}<br />{isDiff ? signed(item.value) : mm(item.value)}</Tooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
              <Legend diff={isDiff} />
            </div>
          )}
        </div>

        <aside className="list-card card" aria-label="Districts">
          <div className="list-head">
            <label className="input input-icon">
              <Search size={16} aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search district or state" aria-label="Search district or state" />
            </label>
            <span className="muted small">{isDiff ? 'Sorted by size of correction' : 'Sorted by rainfall'} · {list.length}</span>
          </div>
          <ul className="district-list">
            {!forecast.data && Array.from({ length: 8 }, (_, i) => <li key={i} className="pad-sm"><Skeleton height={34} /></li>)}
            {list.map((item) => (
              <li key={item.district_id}>
                <button className={selected === item.district_id ? 'is-selected' : ''} onClick={() => setSelected(item.district_id)}>
                  <span className="swatch" style={{ background: color(item.value) }} />
                  <span className="district-name"><strong>{item.district}</strong><small>{item.state} · {isDiff ? item.dominant_regime : rainBands[Math.max(0, rainBands.findIndex((b) => item.value < b.max))].label}</small></span>
                  <b className="num">{isDiff ? signed(item.value) : mm(item.value)}</b>
                </button>
              </li>
            ))}
            {forecast.data && list.length === 0 && <li className="pad"><Empty title="No matching district">Try a different name or state.</Empty></li>}
          </ul>
        </aside>
      </div>

      <DistrictDrawer id={selected} name={current?.district} state={current?.state} date={date} lead={lead} onClose={() => setSelected(null)} />
    </div>
  );
}
