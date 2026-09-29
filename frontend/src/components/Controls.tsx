import type { ReactNode } from 'react';
import { CalendarDays, Radio } from 'lucide-react';
import { useLive, useMeta } from '../data';
import { formatDate } from '../lib';
import { useForecastStore, type Source } from '../store';
import { Segmented } from './ui';

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar card">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><span className="field-label">{label}</span>{children}</div>;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function DateLeadControls() {
  const meta = useMeta();
  const { source, setSource, date, lead, setDate, setLead } = useForecastStore();
  const live = useLive(source === 'live');
  const dates = meta.data?.dates;
  const validDay = live.data?.date;
  return (
    <>
      <Field label="Data">
        <Segmented id="source" label="Data source" value={source} onChange={(v: Source) => setSource(v)}
          options={[{ value: 'live', label: 'Live NWP' }, { value: 'season', label: 'Verified season' }]} />
      </Field>
      {source === 'season' ? (
        <Field label="Date">
          <label className="input input-icon">
            <CalendarDays size={16} aria-hidden />
            <input type="date" aria-label="Forecast date" value={date} min={dates?.[0]} max={dates?.at(-1)}
              onChange={(e) => dates?.includes(e.target.value) && setDate(e.target.value)} />
          </label>
        </Field>
      ) : (
        <Field label="Valid for">
          <span className="input input-static"><Radio size={15} aria-hidden className="live-dot" />{validDay ? dayLabel(validDay) : 'Fetching…'}</span>
        </Field>
      )}
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
