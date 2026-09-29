import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { m } from 'motion/react';
import { ArrowRight, MapPinned, Search } from 'lucide-react';
import { useLive, useVerification } from '../data';
import { escapeHtml, levelFill, LEVELS, mm, pct, warningLevel, type Forecast } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { IndiaMap } from '../components/IndiaMap';
import { ErrorState, GateChip, Reveal, Skeleton, ease } from '../components/ui';

const steps = [
  { title: 'Read the pattern', text: 'A calibrated classifier gives every district-day a probability for each of six monsoon regimes.', to: '/regimes' },
  { title: 'Correct for it', text: 'Regime-specific models, blended by those probabilities, turn raw NWP rainfall into a low, best and high estimate.', to: '/method' },
  { title: 'Price the risk', text: 'Calibrated chances of crossing IMD’s 64.5, 115.6 and 204.5 mm thresholds, shown in the familiar colour code.', to: '/alerts' },
  { title: 'Prove it first', text: 'A regime’s correction is served only after it beats raw and a single global fix on a season it never saw.', to: '/verification' },
];

const dayName = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) : '');

/** Live map of today's colour-coded risk, with the numbers a duty officer would ask for first. */
function LiveHero() {
  const live = useLive(true);
  const theme = useResolvedTheme();
  const setSource = useForecastStore((s) => s.setSource);
  const items: Forecast[] = useMemo(() => live.data?.items ?? [], [live.data]);
  const counts = LEVELS.map((l) => items.filter((i) => warningLevel(i).key === l.key).length);
  const wettest = items.reduce<Forecast | null>((w, i) => (!w || i.served_mm > w.served_mm ? i : w), null);
  const tooltip = (i: Forecast) => `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>Served</span><b>${mm(i.served_mm)}</b><span>Heavy-rain chance</span><b>${pct(i.prob_64_5)}</b><span>Level</span><b>${warningLevel(i).name}</b></div>`;
  const at = live.data?.fetched_at ? new Date(live.data.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <m.div className="hero-map card" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.1 }}>
      <div className="hero-map-head">
        <div>
          <span className="label">{items.length ? <><span className="live-dot" aria-hidden /> Live · run {at}</> : 'Live NWP'}</span>
          <strong>{live.data?.date ? dayName(live.data.date) : 'Today’s forecast'}</strong>
        </div>
        <Link to="/forecast" className="link" onClick={() => setSource('live')}>Open map <ArrowRight size={14} aria-hidden /></Link>
      </div>
      <div className="hero-map-body">
        {live.isError && !items.length ? <div className="pad"><ErrorState error={live.error} /></div>
          : !items.length ? <Skeleton height="100%" className="map-skeleton" />
          : <IndiaMap items={items} color={(i) => levelFill(warningLevel(i), theme)} tooltip={tooltip} />}
      </div>
      <div className="hero-map-foot">
        <ul className="level-counts" aria-label="Districts by warning level">
          {[...LEVELS].reverse().map((l) => (
            <li key={l.key}><i style={{ background: levelFill(l, theme) }} /><b className="num">{items.length ? counts[LEVELS.indexOf(l)] : '—'}</b> {l.name.toLowerCase()}</li>
          ))}
        </ul>
        {wettest && <span className="muted small">Wettest: <b className="ink">{wettest.district}</b> {mm(wettest.served_mm)}</span>}
      </div>
    </m.div>
  );
}

function Evidence() {
  const verification = useVerification();
  const v = verification.data;
  if (verification.isError) return <ErrorState error={verification.error} />;
  const at = (model: string) => v?.scores.Overall?.[model]?.['64.5'];
  const raw = at('Raw'), ours = at('Regime-aware'), global = at('Global');
  const passed = v ? v.regimes.filter((r) => v.gate[r]?.status === 'Corrected') : [];
  const figures = raw && ours && global ? [
    { label: 'Rainfall error', value: `${ours.rmse.toFixed(1)} mm`, delta: `${pct((raw.rmse - ours.rmse) / raw.rmse)} lower`, note: `RMSE · raw ${raw.rmse.toFixed(1)}, global fix ${global.rmse.toFixed(1)}` },
    { label: 'Heavy-rain hit score', value: (ours.csi ?? 0).toFixed(2), delta: `+${pct(((ours.csi ?? 0) - (raw.csi ?? 0)) / (raw.csi || 1))}`, note: `CSI at ≥ 64.5 mm · raw ${(raw.csi ?? 0).toFixed(2)}` },
    { label: 'Heavy rain caught', value: pct(ours.pod ?? 0), delta: `was ${pct(raw.pod ?? 0)}`, note: 'Probability of detection · ≥ 64.5 mm' },
  ] : [];

  return (
    <section className="evidence">
      <Reveal className="evidence-head">
        <span className="label">Measured on a season the models never saw</span>
        <h2 className="display section-display">Better where it matters — <em>and only where it’s proven.</em></h2>
      </Reveal>
      <div className="evidence-grid">
        {!v ? Array.from({ length: 3 }, (_, i) => <div key={i} className="figure"><Skeleton height={90} /></div>) : figures.map((f, i) => (
          <Reveal key={f.label} delay={i * 0.06} className="figure">
            <span className="figure-label">{f.label}</span>
            <strong className="figure-value num">{f.value}</strong>
            <span className="figure-delta">{f.delta}</span>
            <span className="figure-note">{f.note}</span>
          </Reveal>
        ))}
        {v && (
          <Reveal delay={0.18} className="figure figure-gate">
            <span className="figure-label">Corrections live</span>
            <strong className="figure-value num">{passed.length}<span> of {v.regimes.length}</span></strong>
            <span className="figure-note">regimes passed the verification gate</span>
            <ul className="gate-mini">
              {v.regimes.map((r) => <li key={r}><span>{r}</span><GateChip status={v.gate[r].status} /></li>)}
            </ul>
          </Reveal>
        )}
      </div>
      <Link to="/verification" className="link">Read the full verification <ArrowRight size={14} aria-hidden /></Link>
    </section>
  );
}

function DistrictJump() {
  const live = useLive(true);
  const navigate = useNavigate();
  const setSource = useForecastStore((s) => s.setSource);
  const [q, setQ] = useState('');
  const names = useMemo(() => (live.data?.items ?? []).map((i) => ({ id: i.district_id, label: `${i.district}, ${i.state}` })), [live.data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim().toLowerCase();
    const hit = names.find((n) => n.label.toLowerCase() === text) ?? names.find((n) => n.label.toLowerCase().startsWith(text)) ?? names.find((n) => n.label.toLowerCase().includes(text));
    setSource('live');
    navigate(hit ? `/forecast?district=${hit.id}` : '/forecast');
  };
  return (
    <Reveal as="section" className="jump">
      <div>
        <h2 className="display section-display">What’s coming for <em>your district?</em></h2>
        <p>Five days of corrected rainfall, heavy-rain chances and the weather regime behind them.</p>
      </div>
      <form className="jump-form" onSubmit={submit} role="search">
        <label className="input input-icon jump-input">
          <Search size={17} aria-hidden />
          <input list="district-names" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a district, e.g. Pune" aria-label="District name" />
        </label>
        <datalist id="district-names">{names.map((n) => <option key={n.id} value={n.label} />)}</datalist>
        <button className="btn btn-light" type="submit">Show forecast <ArrowRight size={16} aria-hidden /></button>
      </form>
    </Reveal>
  );
}

export default function Overview() {
  return (
    <div className="page overview">
      <section className="hero">
        <div className="hero-copy">
          <m.span className="label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
            Regime-aware rainfall post-processing · India
          </m.span>
          <m.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.05 }}>
            A clearer rainfall forecast for <em>every monsoon pattern.</em>
          </m.h1>
          <m.p className="lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.12 }}>
            MonsoonLens reads the weather regime behind each district forecast, corrects the model’s rainfall for it, and publishes a correction only where held-out evidence says it helps.
          </m.p>
          <m.div className="hero-actions" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.2 }}>
            <Link className="btn btn-primary btn-lg" to="/forecast"><MapPinned size={17} aria-hidden /> Open the forecast map</Link>
            <Link className="btn btn-ghost btn-lg" to="/method">How it works <ArrowRight size={16} aria-hidden /></Link>
          </m.div>
        </div>
        <LiveHero />
      </section>

      <Evidence />

      <section className="section">
        <Reveal className="section-head">
          <div>
            <span className="label">How it works</span>
            <h2 className="display section-display">Four steps, <em>each one checked.</em></h2>
          </div>
          <Link to="/method" className="link">The full method <ArrowRight size={14} aria-hidden /></Link>
        </Reveal>
        <ol className="rail">
          {steps.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 0.07} className="rail-step">
              <Link to={s.to}>
                <span className="rail-num">0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <span className="feature-link">Explore <ArrowRight size={14} aria-hidden /></span>
              </Link>
            </Reveal>
          ))}
        </ol>
      </section>

      <DistrictJump />
    </div>
  );
}
