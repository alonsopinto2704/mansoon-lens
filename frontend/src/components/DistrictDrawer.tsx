import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { Info, X } from 'lucide-react';
import { gateReason, get, mm, pct, regimeColor, type District } from '../lib';
import { useResolvedTheme } from '../store';
import { Bar, ErrorState, GateChip, LoadingBlock, ease } from './ui';

const driverLabels: Record<string, string> = { moisture: 'Moisture index', wind: 'Wind index', mslp: 'Pressure anomaly', terrain_m: 'Terrain (m)', coast_km: 'Distance to coast (km)' };

function Content({ id, date, lead }: { id: string; date: string; lead: number }) {
  const theme = useResolvedTheme();
  const detail = useQuery({ queryKey: ['district', id, date, lead], queryFn: () => get<District>(`/districts/${id}?date=${date}&lead=${lead}`) });
  if (detail.isError) return <div className="drawer-body"><ErrorState error={detail.error} /></div>;
  const item = detail.data;
  if (!item) return <div className="drawer-body"><LoadingBlock rows={8} label="Loading district forecast" /></div>;
  const span = Math.max(item.corrected_p90, 1);
  return (
    <div className="drawer-body">
      <div className="drawer-hero">
        <span className="label">Served rainfall</span>
        <div className="drawer-value"><strong className="num">{item.served_mm.toFixed(1)}</strong><span>mm / day</span><GateChip status={item.gate_status} /></div>
        <p className="muted">{gateReason(item.gate_reason)}</p>
      </div>

      <div className="drawer-section">
        <h3>Likely range</h3>
        <div className="range">
          <div className="range-track">
            <m.span className="range-band" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease }} style={{ left: `${(item.corrected_p10 / span) * 100}%`, right: 0 }} />
            <span className="range-mid" style={{ left: `${(item.corrected_p50 / span) * 100}%` }} />
          </div>
          <div className="range-labels">
            <span>Low (P10)<b className="num">{mm(item.corrected_p10)}</b></span>
            <span>Median<b className="num">{mm(item.corrected_p50)}</b></span>
            <span>High (P90)<b className="num">{mm(item.corrected_p90)}</b></span>
          </div>
        </div>
      </div>

      <div className="drawer-section">
        <h3>Heavy-rain chance</h3>
        <div className="risk-grid">
          {([['Heavy', '≥ 64.5 mm', item.prob_64_5], ['Very heavy', '≥ 115.6 mm', item.prob_115_6], ['Extreme', '≥ 204.5 mm', item.prob_204_5]] as const).map(([label, cut, p]) => (
            <div key={cut}><span>{label}</span><strong className="num">{pct(p)}</strong><small>{cut}</small></div>
          ))}
        </div>
        <div className="note"><Info size={16} aria-hidden /><p>{item.advisory}</p></div>
      </div>

      <div className="drawer-section">
        <h3>Weather regime</h3>
        <ul className="prob-list">
          {Object.entries(item.regime_probabilities).sort((a, b) => b[1] - a[1]).map(([name, value]) => (
            <li key={name}><span className="prob-name"><i style={{ background: regimeColor(name, theme) }} />{name}</span><Bar value={value} color={regimeColor(name, theme)} /><b className="num">{pct(value)}</b></li>
          ))}
        </ul>
      </div>

      <div className="drawer-section">
        <h3>Predictors</h3>
        <dl className="kv">
          {item.drivers.map((d) => <div key={d.name}><dt>{driverLabels[d.name] ?? d.name}</dt><dd className="num">{d.value.toFixed(2)}</dd></div>)}
          <div><dt>Raw model rainfall</dt><dd className="num">{mm(item.raw_mm)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

export function DistrictDrawer({ id, name, state, date, lead, onClose }: { id: string | null; name?: string; state?: string; date: string; lead: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!id) return;
    returnFocus.current ??= document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  useEffect(() => {
    if (id) return;
    returnFocus.current?.focus();
    returnFocus.current = null;
  }, [id]);

  return (
    <AnimatePresence>
      {id && (
        <>
          <m.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <m.aside key="drawer" className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}>
            <div className="drawer-head">
              <div>
                <h2 id="drawer-title">{name ?? 'District'}</h2>
                <p>{state}{state ? ' · ' : ''}Day +{lead}</p>
              </div>
              <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close district details"><X size={18} /></button>
            </div>
            <Content id={id} date={date} lead={lead} />
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
