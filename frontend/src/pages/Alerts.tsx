import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download } from 'lucide-react';
import { useForecast } from '../data';
import { get, mm, pct, regimeColor, type Alert } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { DistrictDrawer } from '../components/DistrictDrawer';
import { DateLeadControls, Field, Toolbar } from '../components/Controls';
import { Bar, Empty, ErrorState, GateChip, LoadingBlock, PageHeader, Segmented } from '../components/ui';

const thresholds = [
  { value: '64.5', label: 'Heavy' },
  { value: '115.6', label: 'Very heavy' },
  { value: '204.5', label: 'Extreme' },
];

export default function AlertsPage() {
  const theme = useResolvedTheme();
  const { date, lead } = useForecastStore();
  const [threshold, setThreshold] = useState('64.5');
  const [min, setMin] = useState('0.3');
  const [state, setState] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const query = `/alerts?date=${date}&lead=${lead}&threshold=${threshold}&min_prob=${min}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
  const alerts = useQuery({ queryKey: ['alerts', query], queryFn: () => get<{ items: Alert[] }>(query), enabled: Boolean(date), placeholderData: (p) => p });
  const districts = useForecast();
  const items = alerts.data?.items ?? [];
  const states = useMemo(() => [...new Set(districts.data?.items.map((i) => i.state) ?? [])].sort(), [districts.data]);
  const current = items.find((i) => i.district_id === selected);
  const high = items.filter((i) => i.probability >= 0.6).length;

  return (
    <div className="page">
      <PageHeader title="Heavy-rain alerts" description="Districts ranked by their chance of crossing an IMD rainfall threshold."
        actions={<a className="btn btn-secondary" href={`/api/v1${query}`} download="monsoonlens-alerts.json"><Download size={16} aria-hidden /> Export</a>} />

      <Toolbar>
        <DateLeadControls />
        <Field label="Threshold">
          <Segmented id="threshold" label="Rainfall threshold" value={threshold} onChange={setThreshold} options={thresholds} />
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
      </Toolbar>

      <div className="card table-card">
        <div className="table-head">
          <div>
            <h2>{alerts.data ? `${items.length} district${items.length === 1 ? '' : 's'}` : 'Districts'}</h2>
            <p className="muted small">≥ {threshold} mm in 24 h · {high} with a chance of 60% or more</p>
          </div>
        </div>
        {alerts.isError ? <div className="pad"><ErrorState error={alerts.error} /></div> : !alerts.data ? <div className="pad"><LoadingBlock rows={6} /></div> : items.length === 0 ? (
          <div className="pad"><Empty title="No districts match these filters">Lower the minimum chance or pick another threshold.</Empty></div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>District</th><th>Chance</th><th>Served rainfall</th><th>Regime</th><th>Correction</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.district_id} className="row-link" onClick={() => setSelected(i.district_id)}>
                    <td><strong>{i.district}</strong><small className="muted block">{i.state}</small></td>
                    <td><div className="prob-cell"><Bar value={i.probability} color={i.probability >= 0.6 ? 'var(--danger)' : i.probability >= 0.3 ? 'var(--warn)' : 'var(--text-3)'} /><b className="num">{pct(i.probability)}</b></div></td>
                    <td className="num">{mm(i.served_mm)}</td>
                    <td><span className="regime-tag"><i style={{ background: regimeColor(i.dominant_regime, theme) }} />{i.dominant_regime}</span></td>
                    <td><GateChip status={i.gate_status} /></td>
                    <td className="align-right"><button className="icon-btn" aria-label={`Details for ${i.district}`} onClick={(e) => { e.stopPropagation(); setSelected(i.district_id); }}><ChevronRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="footnote">Sample-data demonstration. For real warnings, follow the India Meteorological Department.</p>

      <DistrictDrawer id={selected} name={current?.district} state={current?.state} date={date} lead={lead} onClose={() => setSelected(null)} />
    </div>
  );
}
