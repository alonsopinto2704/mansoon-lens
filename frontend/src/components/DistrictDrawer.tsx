import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { Check, Info, Link2, X } from 'lucide-react';
import { formatDate, gateReason, get, mm, pct, probColor, regimeColor, warningLevel, type District } from '../lib';
import { useResolvedTheme } from '../store';
import { Bar, ErrorState, GateChip, LevelChip, LoadingBlock, ease } from './ui';

const driverLabels: Record<string, string> = { moisture: 'Moisture index', wind: 'Wind index', mslp: 'Pressure anomaly', terrain_m: 'Terrain (m)', coast_km: 'Distance to coast (km)' };

function Content({ id, date, lead, live }: { id: string; date: string; lead: number; live?: District }) {
  const theme = useResolvedTheme();
  const detail = useQuery({ queryKey: ['district', id, date, lead], queryFn: () => get<District>(`/districts/${id}?date=${date}&lead=${lead}`), enabled: !live });
  if (!live && detail.isError) return <div className="drawer-body"><ErrorState error={detail.error} /></div>;
  const item = live ?? detail.data;
  if (!item) return <div className="drawer-body"><LoadingBlock rows={8} label="Loading district forecast" /></div>;
  const span = Math.max(item.corrected_p90, 1);
  return (
    <div className="drawer-body">
      <div className="drawer-hero">
        <span className="label">Served rainfall</span>
        <div className="drawer-value"><strong className="num">{item.served_mm.toFixed(1)}</strong><span>mm / day</span></div>
        <div className="drawer-chips"><LevelChip level={warningLevel(item)} withAction /><GateChip status={item.gate_status} /></div>
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
            <span>Best estimate<b className="num">{mm(item.corrected_p50)}</b></span>
            <span>High (P90)<b className="num">{mm(item.corrected_p90)}</b></span>
          </div>
        </div>
      </div>

      {item.observed_mm !== null && item.season && <div className="drawer-section">
        <h3>Forecast vs. what fell</h3>
        <div className="risk-grid">
          <div><span>Raw model</span><strong className="num">{item.raw_mm.toFixed(1)}</strong><small>mm</small></div>
          <div><span>Served</span><strong className="num">{item.served_mm.toFixed(1)}</strong><small>mm</small></div>
          <div><span>Observed</span><strong className="num">{item.observed_mm?.toFixed(1)}</strong><small>mm · held-out</small></div>
        </div>
        <p className="muted small mt">
          Over the held-out season at day +{lead}, this district’s error was <b className="num">{mm(item.season.rmse_served)}</b> served vs <b className="num">{mm(item.season.rmse_raw)}</b> raw (RMSE, {item.season.days} days, {item.season.heavy_days} heavy-rain days).
        </p>
      </div>}
      {live && <div className="drawer-section">
        <h3>Raw NWP vs. served</h3>
        <div className="risk-grid">
          <div><span>Raw NWP</span><strong className="num">{item.raw_mm.toFixed(1)}</strong><small>mm · Open-Meteo</small></div>
          <div><span>Served</span><strong className="num">{item.served_mm.toFixed(1)}</strong><small>mm</small></div>
          <div><span>Change</span><strong className="num">{(item.served_mm - item.raw_mm).toFixed(1)}</strong><small>mm</small></div>
        </div>
        <p className="muted small mt">Live run: correction is unverified on real observations.</p>
      </div>}

      <div className="drawer-section">
        <h3>Heavy-rain chance</h3>
        <div className="risk-grid">
          {([['Heavy', '≥ 64.5 mm', item.prob_64_5], ['Very heavy', '≥ 115.6 mm', item.prob_115_6], ['Extreme', '≥ 204.5 mm', item.prob_204_5]] as const).map(([label, cut, p]) => (
            <div key={cut} className="risk-tile" style={{ ['--risk' as string]: probColor(p, theme) }}><span>{label}</span><strong className="num">{pct(p)}</strong><small>{cut}</small></div>
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

/** Copies the current URL (which carries ?district=) so a district forecast can be shared. */
function CopyLink() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked: nothing to do */ }
  };
  return <button className="icon-btn" onClick={copy} aria-label={done ? 'Link copied' : 'Copy link to this district'} title={done ? 'Link copied' : 'Copy link'}>{done ? <Check size={17} /> : <Link2 size={17} />}</button>;
}

export function DistrictDrawer({ id, name, state, date, lead, live, onClose }: { id: string | null; name?: string; state?: string; date: string; lead: number; live?: District; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = Boolean(id);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key !== 'Tab') return;
      const targets = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      ) ?? []).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) {
        e.preventDefault();
        drawerRef.current?.focus();
      } else if (!drawerRef.current?.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Node && !drawerRef.current?.contains(e.target)) closeRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {id && (
        <>
          <m.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <m.aside ref={drawerRef} tabIndex={-1} key="drawer" className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}>
            <div className="drawer-head">
              <div>
                <h2 id="drawer-title">{name ?? 'District'}</h2>
                <p>{state}{state ? ' · ' : ''}{date && `${formatDate(date)} · `}Day +{lead}</p>
              </div>
              <div className="drawer-actions">
                <CopyLink />
                <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close district details"><X size={18} /></button>
              </div>
            </div>
            <Content id={id} date={date} lead={lead} live={live} />
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
