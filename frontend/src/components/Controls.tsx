import type { ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useMeta } from '../data';
import { useForecastStore } from '../store';
import { Segmented } from './ui';

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar card">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><span className="field-label">{label}</span>{children}</div>;
}

export function DateLeadControls() {
  const meta = useMeta();
  const { date, lead, setDate, setLead } = useForecastStore();
  const dates = meta.data?.dates;
  return (
    <>
      <Field label="Date">
        <label className="input input-icon">
          <CalendarDays size={16} aria-hidden />
          <input type="date" aria-label="Forecast date" value={date} min={dates?.[0]} max={dates?.at(-1)}
            onChange={(e) => dates?.includes(e.target.value) && setDate(e.target.value)} />
        </label>
      </Field>
      <Field label="Lead time">
        <Segmented id="lead" label="Lead time in days" value={lead} onChange={setLead}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `+${n}d` }))} />
      </Field>
    </>
  );
}
