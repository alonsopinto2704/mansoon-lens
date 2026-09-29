import type { ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { m } from 'motion/react';
import { useLive, useLiveDays, useMeta } from '../data';
import { formatDate } from '../lib';
import { useForecastStore, type Source } from '../store';
import { Segmented } from './ui';

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar card">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><span className="field-label">{label}</span>{children}</div>;
}

/** Live / Verified-season switch, plus the season date picker when it applies. */
export function SourceControls() {
  const meta = useMeta();
  const { source, setSource, date, setDate } = useForecastStore();
  const dates = meta.data?.dates;
  return (
    <div className="source-controls">
      <Segmented id="source" label="Data source" value={source} onChange={(v: Source) => setSource(v)}
        options={[{ value: 'live', label: 'Live NWP' }, { value: 'season', label: 'Verified season' }]} />
      {source === 'season' && (
        <label className="input input-icon">
          <CalendarDays size={16} aria-hidden />
          <input type="date" aria-label="Valid date in the held-out season" value={date} min={dates?.[0]} max={dates?.at(-1)}
            onChange={(e) => dates?.includes(e.target.value) && setDate(e.target.value)} />
        </label>
      )}
    </div>
  );
}

const shortDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return { weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }), day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) };
};
const minusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** Lead-day timeline. Live: one tab per valid day with its alert count. Season: same valid day, issued 1–5 days earlier. */
export function DayStrip() {
  const { source, date, lead, setLead } = useForecastStore();
  const days = useLiveDays(source === 'live');
  return (
    <div className="day-strip" role="tablist" aria-label="Forecast day">
      {[1, 2, 3, 4, 5].map((n) => {
        const d = days?.[n - 1];
        const active = n === lead;
        const label = source === 'live' && d?.date ? shortDay(d.date) : null;
        return (
          <button key={n} role="tab" aria-selected={active} className={`day${active ? ' is-active' : ''}`} onClick={() => setLead(n)}>
            {active && <m.span layoutId="day-thumb" className="day-thumb" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
            <span className="day-top">{label ? label.weekday : `Day +${n}`}</span>
            <span className="day-main">{label ? label.day : date ? `issued ${minusDays(date, n)}` : '—'}</span>
            {source === 'live' && d && (
              <span className={`day-badge${d.alerts ? ' has-alerts' : ''}`}>{d.alerts ? `${d.alerts} alert${d.alerts === 1 ? '' : 's'}` : 'No alerts'}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Kept for pages that still use the older inline controls. */
export function DateLeadControls() {
  const { lead, setLead } = useForecastStore();
  return (
    <>
      <Field label="Data"><SourceControls /></Field>
      <Field label="Lead time">
        <Segmented id="lead" label="Lead time in days" value={lead} onChange={setLead}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `+${n}d` }))} />
      </Field>
    </>
  );
}

/** One-line provenance note under the toolbar; says plainly what the numbers are. */
export function SourceNote() {
  const source = useForecastStore((s) => s.source);
  const date = useForecastStore((s) => s.date);
  const live = useLive(source === 'live');
  if (source === 'season') {
    return <p className="source-note">Held-out 2025 sample season{date ? ` · ${formatDate(date)}` : ''}. Observed rainfall is known, so every number here is scored on the Verification page.</p>;
  }
  const d = live.data;
  if (live.isError) return <p className="source-note source-note-warn">Live NWP feed unavailable ({live.error instanceof Error ? live.error.message : 'network error'}). Switch to Verified season.</p>;
  if (!d || d.status === 'fetching' && !d.items.length) return <p className="source-note"><span className="live-dot" /> Fetching today’s NWP run for 781 districts from Open-Meteo…</p>;
  if (!d.items.length) return <p className="source-note source-note-warn">Live NWP feed unavailable{d.error ? ` (${d.error})` : ''}. Switch to Verified season.</p>;
  const at = d.fetched_at ? new Date(d.fetched_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
  if (d.status === 'error') return <p className="source-note source-note-warn" role="status">Live refresh failed. Showing the last available run{at ? `, fetched ${at}` : ''}. <button className="link" onClick={() => live.refetch()}>Try again</button></p>;
  return (
    <p className="source-note"><span className="live-dot" /> Live raw rainfall from Open-Meteo’s global NWP (run fetched {at}{live.refreshing ? ' · checking for a newer run…' : ''}), corrected by MonsoonLens. The correction was trained and verified on sample data, so live corrected values are unverified. For warnings, follow IMD.</p>
  );
}
