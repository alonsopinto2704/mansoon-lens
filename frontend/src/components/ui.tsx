import { useEffect, useRef, useState, type ReactNode } from 'react';
import { m, useInView, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';

export const ease = [0.22, 1, 0.36, 1] as const;

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Fades content up the first time it scrolls into view. */
export function Reveal({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' | 'article' }) {
  const Tag = m[as];
  return (
    <Tag className={className} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, ease, delay }}>
      {children}
    </Tag>
  );
}

export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration, reduced]);
  return <span ref={ref} className="num">{format(shown)}</span>;
}

export function Segmented<T extends string | number>({ id, value, options, onChange, label }: { id: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={active} onClick={() => onChange(o.value)}>
            {active && <m.span layoutId={`seg-${id}`} className="segmented-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="segmented-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function GateChip({ status }: { status: string }) {
  const ok = status === 'Corrected';
  return (
    <span className={`chip ${ok ? 'chip-good' : 'chip-warn'}`}>
      {ok ? <CircleCheck size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
      {ok ? 'Corrected' : 'Raw'}
    </span>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="state state-error" role="alert">
      <CircleAlert size={18} aria-hidden />
      <div>
        <strong>Couldn’t load this data</strong>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', className = '' }: { height?: number | string; width?: number | string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ height, width }} aria-hidden />;
}

export function LoadingBlock({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="loading-block" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={14} width={`${92 - i * 11}%`} />)}
    </div>
  );
}

/** Horizontal bar whose width animates from zero. */
export function Bar({ value, color, max = 1 }: { value: number; color: string; max?: number }) {
  const width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  return (
    <span className="bar-track">
      <m.span className="bar-fill" style={{ background: color }} initial={{ width: 0 }} animate={{ width }} transition={{ duration: 0.7, ease }} />
    </span>
  );
}
