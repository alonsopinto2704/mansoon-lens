import { Link } from 'react-router-dom';
import { m } from 'motion/react';
import { ArrowRight, BellRing, CloudRain, Layers, MapPinned, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useMeta, useVerification } from '../data';
import { modelColors, regimeColor } from '../lib';
import { useResolvedTheme } from '../store';
import { Bar, CountUp, ErrorState, GateChip, Reveal, Skeleton, ease } from '../components/ui';

const MODELS = ['Raw', 'Global', 'Regime-aware'] as const;

const features = [
  { icon: Layers, title: 'Regime detection', text: 'Every district-day gets calibrated probabilities across six monsoon regimes — from active spells to breaks and depressions.', to: '/regimes' },
  { icon: SlidersHorizontal, title: 'Bias correction', text: 'Regime-specific models are blended by those probabilities into a low, best-estimate and high rainfall value.', to: '/method' },
  { icon: BellRing, title: 'Heavy-rain chances', text: 'Calibrated probabilities of crossing the IMD heavy, very heavy and extremely heavy thresholds.', to: '/alerts' },
  { icon: ShieldCheck, title: 'Verified before served', text: 'A correction only goes live for a regime when held-out tests show it beats both the raw and a one-size-fits-all fix.', to: '/verification' },
];

function Preview() {
  const theme = useResolvedTheme();
  const verification = useVerification();
  const v = verification.data;
  const passed = v ? v.regimes.filter((r) => v.gate[r]?.status === 'Corrected') : [];
  const shown = passed.length ? passed : ['Overall'];
  const rmse = (group: string, model: string) => v?.scores[group]?.[model]?.['64.5']?.rmse ?? 0;
  const label = { Raw: 'Raw model', Global: 'Global fix', 'Regime-aware': 'MonsoonLens' };

  return (
    <m.div className="preview card" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, ease, delay: 0.15 }}>
      <div className="preview-head">
        <span className="label">Error where correction is live</span>
        <span className="muted small">RMSE · lower is better</span>
      </div>
      {verification.isError ? <div><ErrorState error={verification.error} /><button className="btn btn-secondary mt" onClick={() => verification.refetch()}>Try again</button></div> : !v ? <div className="loading-block"><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /></div> : (
        <div className="compare-groups">
          {shown.map((group) => {
            const max = Math.max(...MODELS.map((x) => rmse(group, x)), 1);
            return (
              <div key={group}>
                <span className="compare-group">{group === 'Overall' ? 'All regimes' : `${group} regime`}</span>
                <ul className="compare">
                  {MODELS.map((x) => (
                    <li key={x} className={x === 'Regime-aware' ? 'is-ours' : ''}>
                      <span className="compare-name">{label[x]}</span>
                      <Bar value={rmse(group, x)} max={max} color={modelColors[theme][x]} />
                      <b className="num">{rmse(group, x).toFixed(1)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <div className="preview-foot">
        <div>
          <span className="label">Corrections live</span>
          <strong className="num">{v ? `${passed.length} of ${v.regimes.length}` : '—'}</strong>
          <span className="muted small">regimes passed the gate</span>
        </div>
        <div className="regime-dots" aria-label="Regime gate status">
          {v?.regimes.map((r) => (
            <span key={r} className="regime-dot" data-pass={v.gate[r]?.status === 'Corrected'} title={`${r}: ${v.gate[r]?.status}`}>
              <i style={{ background: regimeColor(r, theme) }} />{r}
            </span>
          ))}
        </div>
      </div>
    </m.div>
  );
}

export default function Overview() {
  const meta = useMeta();
  const verification = useVerification();
  const v = verification.data;
  const stats = [
    { value: meta.data?.district_count, label: 'Districts covered' },
    { value: 6, label: 'Monsoon regimes' },
    { value: 5, label: 'Days of lead time' },
    { value: v?.test_rows, label: 'Held-out forecasts scored' },
  ];

  return (
    <div className="page overview">
      <div className="overview-eyebrow"><span>MONSOON INTELLIGENCE</span><span>INDIA / SIH 2026</span></div>
      <section className="hero">
        <div className="hero-copy">
          <m.span className="pill" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
            <CloudRain size={14} aria-hidden /> Regime-aware rainfall post-processing
          </m.span>
          <m.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.05 }}>
            Every weather pattern.<br /><span className="accent-text">A clearer rainfall forecast.</span>
          </m.h1>
          <m.p className="lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.12 }}>
            MonsoonLens reads the weather pattern behind each forecast, corrects model rainfall for that pattern, and only publishes the correction where the evidence says it helps.
          </m.p>
          <m.div className="hero-actions" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.2 }}>
            <Link className="btn btn-primary" to="/forecast"><MapPinned size={16} aria-hidden /> Open the forecast map</Link>
            <Link className="btn btn-ghost" to="/method">How it works <ArrowRight size={16} aria-hidden /></Link>
          </m.div>
          <p className="hero-disclosure"><ShieldCheck size={15} aria-hidden /> Research demo · Verified on synthetic data</p>
        </div>
        <Preview />
      </section>

      <section className="stats" aria-label="Key figures">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.06} className="stat">
            <strong>{typeof s.value === 'number' ? <CountUp value={s.value} /> : (i === 0 ? meta.isError : verification.isError) ? <span aria-label="Unavailable">—</span> : <Skeleton height={32} width={80} />}</strong>
            <span>{s.label}</span>
          </Reveal>
        ))}
      </section>

      <section className="section">
        <Reveal className="section-head section-head-center">
          <div>
            <h2>Understand the pattern. See the difference.</h2>
            <p>Four steps, each one visible and measurable.</p>
          </div>
        </Reveal>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text, to }, i) => (
            <Reveal key={title} delay={i * 0.07}>
              <Link to={to} className="feature card card-hover">
                <div className="feature-top"><span className="feature-icon"><Icon size={20} aria-hidden /></span><span className="feature-number">0{i + 1}</span></div>
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="feature-link">Learn more <ArrowRight size={14} aria-hidden /></span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {v && (
        <section className="section">
          <Reveal className="section-head">
            <div>
              <h2>Where correction is live</h2>
              <p>Each regime has to earn its correction on the held-out season.</p>
            </div>
            <Link to="/verification" className="link">See the evidence <ArrowRight size={14} aria-hidden /></Link>
          </Reveal>
          <Reveal className="gate-strip card">
            {v.regimes.map((r) => (
              <div key={r} className="gate-item">
                <span className="gate-name">{r}</span>
                <GateChip status={v.gate[r].status} />
              </div>
            ))}
          </Reveal>
        </section>
      )}

      <Reveal as="section" className="cta card">
        <div>
          <h2>Explore today’s district forecast</h2>
          <p>Today’s live NWP run for all 781 districts, days +1 to +5: compare raw and corrected rainfall, and open any district for its range, regime and heavy-rain chances.</p>
        </div>
        <Link className="btn btn-primary" to="/forecast">Open the map <ArrowRight size={16} aria-hidden /></Link>
      </Reveal>
    </div>
  );
}
