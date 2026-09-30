import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import { useLive, useLiveRun, useVerification } from '../data';
import { useSaved } from '../watchlist';
import { escapeHtml, levelFill, LEVELS, mm, pct, warningLevel, type Forecast } from '../lib';
import { useForecastStore, useResolvedTheme } from '../store';
import { IndiaMap } from '../components/IndiaMap';
import { ErrorState, GateChip, Reveal, Skeleton } from '../components/ui';

const steps = [
  { title: 'Read the pattern', text: 'A calibrated classifier gives every district-day a probability for each of six monsoon regimes.', to: '/regimes' },
  { title: 'Correct for it', text: 'Regime-specific models, blended by those probabilities, turn raw NWP rainfall into a low, best and high estimate.', to: '/method' },
  { title: 'Estimate heavy rain', text: 'See the chance of crossing 64.5, 115.6 and 204.5 mm in a day, with a district outlook for each threshold.', to: '/alerts' },
  { title: 'Prove it first', text: 'A regime’s correction is served only after it beats raw and a single global fix on a season it never saw.', to: '/verification' },
];

const dayName = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) : '');


/** Five-day live outlook for districts the user starred in the district panel. */
function SavedDistricts() {
  const ids = useSaved((s) => s.ids);
  const toggle = useSaved((s) => s.toggle);
  const run = useLiveRun(true);
  const theme = useResolvedTheme();
  const dates = run.data?.dates ?? [];
  const rows = ids.map((id) => ({ id, days: [1, 2, 3, 4, 5].map((lead) => run.data?.items.find((i) => i.district_id === id && i.lead === lead)) }))
    .filter((r) => r.days.some(Boolean));
  if (!run.data?.items.length) return null;
  return (
    <section className="saved">
      <div className="saved-head">
        <h2>Your districts</h2>
        <p className="muted small">{rows.length ? 'Live rainfall and heavy-rain chance for the next five days.' : 'Open a district on the map and press the star to follow it here.'}</p>
      </div>
      {rows.length > 0 && <div className="table-scroll"><table className="table saved-table">
        <thead><tr><th>District</th>{dates.map((d) => <th key={d}>{new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</th>)}<th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>{rows.map(({ id, days }) => {
          const first = days.find(Boolean)!;
          return <tr key={id}>
            <th scope="row"><Link to={`/forecast?source=live&district=${id}`}>{first.district}</Link><small>{first.state}</small></th>
            {days.map((d, n) => <td key={n}>{d ? <Link className="saved-cell" to={`/forecast?source=live&lead=${n + 1}&district=${id}`}
              style={{ ['--level' as string]: levelFill(warningLevel(d), theme) }} title={`${warningLevel(d).name} · ${warningLevel(d).action}`}>
              <b className="num">{mm(d.served_mm)}</b><small>{pct(d.prob_64_5)}</small></Link> : '—'}</td>)}
            <td><button className="icon-btn" onClick={() => toggle(id)} aria-label={`Stop following ${first.district}`}><X size={16} /></button></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
  );
}
/** Live map of today's colour-coded risk, with the numbers a duty officer would ask for first. */
function LiveHero() {
  const live = useLive(true);
  const navigate = useNavigate();
  const theme = useResolvedTheme();
  const items: Forecast[] = useMemo(() => live.data?.items ?? [], [live.data]);
  const error = live.isError ? live.error : live.data?.status === 'error' && !items.length
    ? new Error(live.data.error || 'The live forecast is unavailable. Please try again.') : null;
  const counts = LEVELS.map((l) => items.filter((i) => warningLevel(i).key === l.key).length);
  const wettest = items.reduce<Forecast | null>((w, i) => (!w || i.served_mm > w.served_mm ? i : w), null);
  const tooltip = (i: Forecast) => `<strong>${escapeHtml(i.district)}</strong> · ${escapeHtml(i.state)}<div class="tip-grid"><span>Served</span><b>${mm(i.served_mm)}</b><span>Heavy-rain chance</span><b>${pct(i.prob_64_5)}</b><span>Level</span><b>${warningLevel(i).name}</b></div>`;
  const at = live.data?.fetched_at ? new Date(live.data.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="hero-map card">
      <div className="hero-map-head">
        <div>
          <span className="hero-map-meta">{items.length ? <><span className="live-dot" aria-hidden /> Live NWP · run {at}</> : 'Live NWP'}</span>
          <strong>{live.data?.date ? dayName(live.data.date) : 'Today’s forecast'}</strong>
        </div>
      </div>
      <div className="hero-map-body">
        {error && !items.length ? <div className="pad"><ErrorState error={error} onRetry={() => { void live.refetch(); }} /></div>
          : !items.length ? <Skeleton height="100%" className="map-skeleton" />
          : <IndiaMap compact items={items} color={(i) => levelFill(warningLevel(i), theme)} tooltip={tooltip}
              onSelect={(id) => navigate(`/forecast?source=live&district=${encodeURIComponent(id)}`)} />}
      </div>
      <div className="hero-map-foot">
        <ul className="level-counts" aria-label="Districts by warning level">
          {[...LEVELS].reverse().map((l) => (
            <li key={l.key}><i style={{ background: levelFill(l, theme) }} /><b className="num">{items.length ? counts[LEVELS.indexOf(l)] : '—'}</b> {l.name.toLowerCase()}</li>
          ))}
        </ul>
        {wettest && <span className="muted small">Wettest: <b className="ink">{wettest.district}</b> {mm(wettest.served_mm)}</span>}
      </div>
    </div>
  );
}

function Evidence() {
  const verification = useVerification();
  const v = verification.data;
  if (verification.isError) return <ErrorState error={verification.error} />;
  const at = (model: string) => v?.scores.Overall?.[model]?.['64.5'];
  const raw = at('Raw'), ours = at('Delivered'), global = at('Global');
  const passed = v ? v.regimes.filter((r) => v.gate[r]?.status === 'Corrected') : [];
  const figures = raw && ours && global ? [
    { label: 'Rainfall error', value: `${ours.rmse.toFixed(1)} mm`, delta: `${pct((raw.rmse - ours.rmse) / raw.rmse)} lower`, note: `RMSE · raw ${raw.rmse.toFixed(1)}, global fix ${global.rmse.toFixed(1)}` },
    { label: 'Heavy-rain hit score', value: (ours.csi ?? 0).toFixed(2), delta: `${(ours.csi ?? 0) >= (raw.csi ?? 0) ? '+' : '−'}${pct(Math.abs(((ours.csi ?? 0) - (raw.csi ?? 0)) / (raw.csi || 1)))}`, note: `CSI at ≥ 64.5 mm · raw ${(raw.csi ?? 0).toFixed(2)}` },
    { label: 'Heavy rain caught', value: pct(ours.pod ?? 0), delta: `was ${pct(raw.pod ?? 0)}`, note: 'Probability of detection · ≥ 64.5 mm' },
  ] : [];

  return (
    <section className="evidence">
      <Reveal className="evidence-head">
        <h2>What changed after correction?</h2>
        <p className="evidence-context muted">2025 synthetic test season. The delivered forecast, including raw fallbacks, compared with raw rainfall and a global correction. These are retrospective synthetic results: the gate was chosen on the same season. They do not measure live forecast skill.</p>
      </Reveal>
      <div className="evidence-grid">
        {!v ? Array.from({ length: 3 }, (_, i) => <div key={i} className="figure"><Skeleton height={90} /></div>) : figures.map((f) => (
          <Reveal key={f.label} className="figure">
            <span className="figure-label">{f.label}</span>
            <strong className="figure-value num">{f.value}</strong>
            <span className="figure-delta">{f.delta}</span>
            <span className="figure-note">{f.note}</span>
          </Reveal>
        ))}
        {v && (
          <Reveal className="figure figure-gate">
            <span className="figure-label">Regimes passing the demo gate</span>
            <strong className="figure-value num">{passed.length}<span> of {v.regimes.length}</span></strong>
            <span className="figure-note">regimes passed the verification gate</span>
            <ul className="gate-mini">
              {v.regimes.map((r) => <li key={r}><span>{r}</span><GateChip status={v.gate[r].status} /></li>)}
            </ul>
          </Reveal>
        )}
      </div>
      <Link to="/verification" className="link">Full verification</Link>
    </section>
  );
}

function DistrictJump() {
  const live = useLive(true);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [searchError, setSearchError] = useState('');
  const names = useMemo(() => (live.data?.items ?? []).map((i) => ({ id: i.district_id, label: `${i.district}, ${i.state}` })), [live.data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim().toLowerCase();
    if (!text) { navigate('/forecast?source=live'); return; }
    if (!names.length) {
      setSearchError(live.isPending ? 'District list is loading. Try again shortly.' : 'District list is unavailable. Open the forecast map to try again.');
      return;
    }
    const matches = names.filter((n) => n.label.toLowerCase().includes(text));
    const hit = matches.find((n) => n.label.toLowerCase() === text) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!hit) {
      setSearchError(matches.length ? 'Several districts match. Choose a full name from the suggestions.' : 'No matching district. Check the name and try again.');
      return;
    }
    setSearchError('');
    navigate(`/forecast?source=live&district=${encodeURIComponent(hit.id)}`);
  };
  return (
    <Reveal as="section" className="jump">
      <div>
        <h2>Find a district</h2>
        <p>Search the five-day outlook by name or state.</p>
      </div>
      <form className="jump-form" onSubmit={submit} role="search">
        <label className="input input-icon jump-input">
          <Search size={17} aria-hidden />
          <input list="district-names" value={q} onChange={(e) => { setQ(e.target.value); setSearchError(''); }} placeholder="Type a district, e.g. Pune" aria-label="District name" aria-invalid={Boolean(searchError)} aria-describedby={searchError ? 'district-search-error' : undefined} />
        </label>
        <datalist id="district-names">{names.map((n) => <option key={n.id} value={n.label} />)}</datalist>
        <button className="btn btn-light" type="submit">Show forecast</button>
      </form>
      {searchError && <p id="district-search-error" className="search-error" role="alert">{searchError}</p>}
    </Reveal>
  );
}

export default function Overview() {
  const setSource = useForecastStore((st) => st.setSource);
  return (
    <div className="page overview">
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">India / district outlook</span>
          <h1>Rainfall, district by district.</h1>
          <p className="lead">A five-day view of rainfall and heavy-rain chances across 781 districts.</p>
          <Link className="btn btn-primary" to="/forecast" onClick={() => setSource('live')}>Explore the forecast <ArrowRight size={16} aria-hidden /></Link>
        </div>
        <DistrictJump />
        <p className="hero-note">Research prototype · Live NWP input, correction trained on synthetic data. Not an official forecast; for warnings, follow IMD.</p>
        <LiveHero />
      </section>

      <SavedDistricts />

      <Evidence />

      <section className="section">
        <h2>How it works</h2>
        <ul className="how-list">
          {steps.map((st) => (
            <li key={st.title}><Link to={st.to}><b>{st.title}.</b></Link> {st.text}</li>
          ))}
        </ul>
        <p className="muted small">Details on the <Link to="/method" className="link">method page</Link>.</p>
      </section>

    </div>
  );
}
