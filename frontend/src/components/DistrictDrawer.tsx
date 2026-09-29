import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { Check, Info, Link2, Star, X } from 'lucide-react';
import { formatDate, gateReason, get, mm, pct, probColor, regimeColor, warningLevel, type District } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { useLiveRun, useMeta } from '../data';
import { useSaved } from '../watchlist';
import { Bar, ErrorState, GateChip, LevelChip, LoadingBlock, ease } from './ui';

const driverLabels: Record<string, string> = { moisture: 'Moisture index', wind: 'Wind index', mslp: 'Pressure anomaly', terrain_m: 'Terrain (m)', coast_km: 'Distance to coast (km)' };

function DistrictOutlook({ id, date, lead, live }: { id: string; date: string; lead: number; live: boolean }) {
  const run = useLiveRun(live);
  const meta = useMeta();
  const { setDate, setLead } = useForecastStore();
  // Season dates advance at a fixed lead; live days share the same fetched run.
  const dates = live ? run.data?.dates ?? [] : Array.from({ length: 5 }, (_, n) => {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + n);
    return day.toISOString().slice(0, 10);
  });
  const season = useQueries({ queries: dates.map((day) => ({
    queryKey: ['district', id, day, lead], queryFn: () => get<District>(`/districts/${id}?date=${day}&lead=${lead}`),
    enabled: !live && Boolean(meta.data?.dates.includes(day)),
  })) });
  // Summing is only meaningful within one live run; season days are separate forecasts.
  const liveRows = live ? [1, 2, 3, 4, 5].map((n) => run.data?.items.find((i) => i.district_id === id && i.lead === n)) : [];
  const total = liveRows.length && liveRows.every(Boolean) ? liveRows.reduce((sum, r) => sum + r!.served_mm, 0) : null;
  return <div className="drawer-section">
    <h3>{live ? 'Five-day outlook' : 'Five-day season view'}</h3>
    <p className="muted small">{live ? 'Rainfall and heavy-rain chance from the same run. Select a day for details.' : `Consecutive valid dates at day +${lead}; these are separate historical forecasts.`}</p>
    <div className="district-outlook">
      {dates.map((day, n) => {
        const row = live ? run.data?.items.find((i) => i.district_id === id && i.lead === n + 1) : season[n]?.data;
        const unavailable = !live && meta.data && !meta.data.dates.includes(day);
        const failed = !live && season[n]?.isError;
        const active = live ? lead === n + 1 : n === 0;
        return <button key={day} className={active ? 'is-active' : ''} aria-pressed={active} disabled={!row}
          onClick={() => live ? setLead(n + 1) : setDate(day)}>
          <span>{new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          <strong className="num">{row ? mm(row.served_mm) : '—'}</strong>
          <small>{row ? `${pct(row.prob_64_5)} heavy` : unavailable ? 'Outside season' : failed ? 'Unavailable' : 'Loading…'}</small>
        </button>;
      })}
    </div>
    <p className="muted small">{live && total !== null ? <>Five-day total <b className="num">{mm(total)}</b> · </> : null}Heavy rain: ≥ 64.5 mm in 24 hours.</p>
    {!live && season.some((q) => q.isError) && <button className="link" onClick={() => season.forEach((q) => { if (q.isError) void q.refetch(); })}>Retry unavailable days</button>}
  </div>;
}

function Content({ id, date, lead, live }: { id: string; date: string; lead: number; live?: District }) {
  const theme = useResolvedTheme();
  const detail = useQuery({ queryKey: ['district', id, date, lead], queryFn: () => get<District>(`/districts/${id}?date=${date}&lead=${lead}`), enabled: !live });
  if (!live && detail.isError) return <div className="drawer-body"><ErrorState error={detail.error} /></div>;
  const item = live ?? detail.data;
  if (!item) return <div className="drawer-body"><LoadingBlock rows={8} label="Loading district forecast" /></div>;
  const span = Math.max(item.corrected_p90, item.corrected_p50, item.corrected_p10, 1);
  return (
    <div className="drawer-body">
      <div className="drawer-hero">
        <span className="label">Served rainfall</span>
        <div className="drawer-value"><strong className="num">{item.served_mm.toFixed(1)}</strong><span>mm / day</span></div>
        <div className="drawer-chips"><LevelChip level={warningLevel(item)} withAction /><GateChip status={item.gate_status} /></div>
        <p className="muted">{gateReason(item.gate_reason)}</p>
      </div>

      <DistrictOutlook id={id} date={date} lead={lead} live={Boolean(live)} />

      <div className="drawer-section">
        <h3>Correction model range</h3>
        <p className="muted small">{item.gate_status === 'Corrected' ? 'P10–P90 estimates from the correction model; coverage is not guaranteed.' : 'The gate selected raw rainfall. This range belongs to the unused correction model, not the served forecast.'}</p>
        <div className="range">
          <div className="range-track">
            <m.span className="range-band" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease }} style={{ left: `${(item.corrected_p10 / span) * 100}%`, right: 0 }} />
            <span className="range-mid" style={{ left: `${(item.corrected_p50 / span) * 100}%` }} />
          </div>
          <div className="range-labels">
            <span>Low (P10)<b className="num">{mm(item.corrected_p10)}</b></span>
            <span>Model estimate<b className="num">{mm(item.corrected_p50)}</b></span>
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
        <p className="muted small mt">Live run: correction is unverified on real observations. Shared live links open the latest available run; earlier runs are not archived.</p>
      </div>}

      <div className="drawer-section">
        <h3>Heavy-rain chance</h3>
        <p className="muted small">From the probability model, even when the rainfall gate serves raw values. {live ? 'Not verified against live observations.' : ''}</p>
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

function SaveButton({ id }: { id: string }) {
  const { ids, toggle } = useSaved();
  const saved = ids.includes(id);
  return <button className={`icon-btn${saved ? ' is-saved' : ''}`} onClick={() => toggle(id)} aria-pressed={saved}
    aria-label={saved ? 'Remove from saved districts' : 'Save district to the overview'} title={saved ? 'Saved' : 'Save district'}>
    <Star size={17} fill={saved ? 'currentColor' : 'none'} />
  </button>;
}

/** Copies the current URL (which carries ?district=) so a district forecast can be shared. */
function CopyLink() {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const { source } = useForecastStore();
  const run = useLiveRun(source === 'live');
  const copy = async () => {
    const url = new URL(window.location.href);
    if (source === 'live' && run.data?.fetched_at) url.searchParams.set('shared_run', run.data.fetched_at);
    else url.searchParams.delete('shared_run');
    try { await navigator.clipboard.writeText(url.href); setFailed(false); setDone(true); setTimeout(() => setDone(false), 1600); } catch { setFailed(true); }
  };
  return <><button className="icon-btn" onClick={copy} aria-label={done ? 'Link copied' : 'Copy link to this district'} title={done ? 'Link copied' : 'Copy link'}>{done ? <Check size={17} /> : <Link2 size={17} />}</button>{failed && <span role="status" className="small">Copy failed. Copy the address bar link.</span>}</>;
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
                {id && <SaveButton id={id} />}
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
