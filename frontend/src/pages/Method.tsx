import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, BellRing, CheckCheck, Database, GitMerge, Layers, MapPinned, ShieldCheck } from 'lucide-react';
import { PageHeader, Reveal, Section, ease } from '../components/ui';

const steps = [
  { icon: Database, title: 'Inputs', text: 'District forecasts from a numerical weather model, observed rainfall, and geographic and atmospheric predictors — moisture, wind, pressure, terrain and distance to the coast.' },
  { icon: CheckCheck, title: 'Align & quality-check', text: 'Forecasts and observations are matched by district and by the 08:30 IST rain day. Units, ranges and missing values are validated before anything is trained.' },
  { icon: Layers, title: 'Detect the regime', text: 'A calibrated classifier assigns each district-day a probability for each of the six monsoon regimes. The probabilities always sum to one.' },
  { icon: GitMerge, title: 'Blend the correction', text: 'Each regime has its own models for low (P10), best-estimate (conditional mean) and high (P90) rainfall, trained on every row weighted by that regime’s probability. They are blended using the regime probabilities, so transitions stay smooth.' },
  { icon: BellRing, title: 'Estimate heavy-rain chances', text: 'Calibrated models that take the regime probabilities as inputs give the chance of crossing 64.5, 115.6 and 204.5 mm in 24 hours — the IMD heavy, very heavy and extremely heavy thresholds.' },
  { icon: ShieldCheck, title: 'Pass the gate', text: 'On the held-out season, a regime’s correction must beat both the raw forecast and a single global correction (one raw-to-observed mapping per lead time) on RMSE and CSI, with a positive lower 95% bootstrap bound.' },
  { icon: MapPinned, title: 'Serve the district product', text: 'Where the gate passed, the corrected value is served. Everywhere else the raw forecast is served, and the reason is shown alongside it.' },
];

const details = [
  { title: 'Time-based evaluation', text: 'Models train on 2021–2023, calibrate on 2024 and are scored on 2025, a season they never see. Bootstrap intervals resample whole weeks to respect how weather persists from day to day.' },
  { title: 'Soft blend, strict gate', text: 'Blending by probability avoids sudden jumps when the regime is uncertain. The gate is deliberately conservative: a correction that only helps on average, or only against one baseline, is not served.' },
  { title: 'Rainfall thresholds', text: '64.5, 115.6 and 204.5 mm in 24 hours mark heavy, very heavy and extremely heavy rain, following India Meteorological Department terminology.' },
];

const limits = [
  'The training and verification season is simulated over all 781 real districts: rainfall and predictors are generated, so scores describe that sample, not real-world skill.',
  'Live mode runs today’s real Open-Meteo NWP rainfall through the same models. Those corrected values are unverified, and Open-Meteo rain days run 00–24 IST rather than the IMD 08:30 IST day.',
  'Operational use would need NCMRWF NCUM forecasts, IMD gridded observations for training, and independent validation with meteorologists.',
];

const references = [
  'India Meteorological Department — rainfall intensity terminology.',
  'Pai et al. (2014), MAUSAM 65(1) — 0.25° daily gridded rainfall over India.',
  'Hersbach et al. (2020), QJRMS — the ERA5 global reanalysis.',
  'Ebert (2008), Meteorological Applications — neighbourhood verification of precipitation forecasts.',
  'Gneiting & Raftery (2007), JASA — proper scoring rules for probabilistic forecasts.',
];

export default function MethodPage() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const Icon = step.icon;
  return (
    <div className="page">
      <PageHeader title="How it works" description="Every district number traces back through seven steps. Select a step to see what happens there." />

      <div className="pipeline">
        <ol className="pipeline-steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button className={`pipeline-step ${i === active ? 'is-active' : ''}`} onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}>
                {i === active && <m.span layoutId="step-bg" className="pipeline-step-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="step-num num">{String(i + 1).padStart(2, '0')}</span>
                <span className="step-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="pipeline-detail card">
          <AnimatePresence mode="wait">
            <m.div key={active} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25, ease }}>
              <span className="feature-icon feature-icon-lg"><Icon size={26} aria-hidden /></span>
              <span className="label">Step {active + 1} of {steps.length}</span>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              {active === 5 && (
                <div className="decision">
                  <div className="decision-q">Beats raw <em>and</em> global correction?</div>
                  <div className="decision-a good">Yes → serve corrected rainfall</div>
                  <div className="decision-a warn">No → serve raw, show the reason</div>
                </div>
              )}
              <div className="pipeline-nav">
                <button className="btn btn-secondary" disabled={active === 0} onClick={() => setActive(active - 1)}>Previous</button>
                {active < steps.length - 1
                  ? <button className="btn btn-primary" onClick={() => setActive(active + 1)}>Next step <ArrowRight size={16} aria-hidden /></button>
                  : <Link className="btn btn-primary" to="/verification">See the results <ArrowRight size={16} aria-hidden /></Link>}
              </div>
            </m.div>
          </AnimatePresence>
        </div>
      </div>

      <Section title="Design choices">
        <div className="grid-3">
          {details.map((d, i) => <Reveal key={d.title} delay={i * 0.06} className="card pad"><h3>{d.title}</h3><p className="muted">{d.text}</p></Reveal>)}
        </div>
      </Section>

      <div className="grid-2">
        <Section title="Limitations">
          <ul className="card pad bullet-list">{limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </Section>
        <Section title="Further reading">
          <ul className="card pad bullet-list">{references.map((r) => <li key={r}>{r}</li>)}</ul>
        </Section>
      </div>
    </div>
  );
}
