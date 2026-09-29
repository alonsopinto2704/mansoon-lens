import { useEffect, useRef, useState, type ReactNode } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { Level } from '../lib';

export const ease = [0.22, 1, 0.36, 1] as const;

export function PageHeader({ title, eyebrow, description, actions }: { title: ReactNode; eyebrow?: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="label">{eyebrow}</span>}
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

/** A brief entrance for secondary sections; reduced-motion users see content immediately. */
export function Reveal({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' | 'article' }) {
  const Tag = m[as];
  const reduced = useReducedMotion();
  return (
    <Tag className={className} initial={reduced ? false : { opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: reduced ? 0 : 0.22, ease, delay: reduced ? 0 : Math.min(delay, 0.08) }}>
      {children}
    </Tag>
  );
}

/** Shows the real value immediately and tweens when it changes (never renders a placeholder number). */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 600 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value) { setShown(value); return; }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setShown(start + (value - start) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const done = window.setTimeout(() => setShown(value), duration + 100); // rAF pauses in background tabs
    return () => { cancelAnimationFrame(frame); window.clearTimeout(done); };
  }, [value, duration, reduced]);
  return <span className="num">{format(shown)}</span>;
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

/** IMD-scheme level with its colour, name and (for screen readers and colour-blind readers) the action. */
export function LevelChip({ level, withAction = false }: { level: Level; withAction?: boolean }) {
  return <span className={`level-chip level-${level.key}`} title={level.action}><i style={{ background: level.color }} aria-hidden />{level.name}{withAction ? ` · ${level.action}` : <span className="sr-only"> · {level.action}</span>}</span>;
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

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <CircleAlert size={18} aria-hidden />
      <div>
        <strong>Couldn’t load this data</strong>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {onRetry && <button type="button" className="btn btn-secondary mt" onClick={onRetry}>Try again</button>}
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
