import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { Menu, Monitor, Moon, Sun, X } from 'lucide-react';
import { useLive, useMeta } from './data';
import { useForecastStore, useResolvedTheme } from './store';
import { LoadingBlock, ease } from './components/ui';
import { readForecastView } from './forecastUrl';

function ForecastLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { source, date, lead, layer } = useForecastStore();
  const previous = useRef<string>();
  useLayoutEffect(() => {
    if (!['/forecast', '/alerts'].includes(location.pathname)) { previous.current = undefined; return; }
    const key = location.pathname + location.search;
    if (previous.current !== key) {
      previous.current = key;
      const incoming = readForecastView(new URLSearchParams(location.search));
      const next = { source, date, lead, layer, ...incoming };
      if (next.source === 'live' && next.layer === 'observed') next.layer = 'corrected';
      if (next.source !== source || next.date !== date || next.lead !== lead || next.layer !== layer) {
        useForecastStore.setState(next);
        return;
      }
    }
    const params = new URLSearchParams(location.search);
    params.set('source', source);
    params.set('lead', String(lead));
    params.set('layer', layer);
    if (source === 'season' && date) params.set('date', date); else params.delete('date');
    const search = `?${params}`;
    if (search !== location.search) {
      previous.current = location.pathname + search;
      navigate({ pathname: location.pathname, search }, { replace: true });
    }
  }, [source, date, lead, layer, location.pathname, location.search, navigate]);
  return null;
}

const Overview = lazy(() => import('./pages/Overview'));
const ForecastPage = lazy(() => import('./pages/Forecast'));
const AlertsPage = lazy(() => import('./pages/Alerts'));
const RegimesPage = lazy(() => import('./pages/Regimes'));
const VerificationPage = lazy(() => import('./pages/Verification'));
const MethodPage = lazy(() => import('./pages/Method'));
const UploadPage = lazy(() => import('./pages/Upload'));

const nav = [
  { to: '/', label: 'Overview' },
  { to: '/forecast', label: 'Forecast' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/regimes', label: 'Regimes' },
  { to: '/verification', label: 'Verification' },
  { to: '/method', label: 'How it works' },
  { to: '/upload', label: 'Upload' },
];

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="10" fill="var(--text)" />
      <path d="M9.5 16.5a6.5 6.5 0 1 1 13 0" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16.5" r="2.6" fill="#5598e7" />
      <path d="M11 22.5l-1 2.5M16 23l-1 2.5M21 22.5l-1 2.5" stroke="#5598e7" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Wordmark() {
  return <span className="wordmark">Monsoon<em>Lens</em></span>;
}

/** Header pill: shows the live NWP run time once it has loaded; links to the map. */
function LiveStatus() {
  const live = useLive(true);
  const d = live.data;
  if (!d?.fetched_at || !d.items.length) return null;
  const at = new Date(d.fetched_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return (
    <Link to="/forecast" className="live-status" title="Latest live NWP run">
      <span className="live-dot" aria-hidden /> Live <span className="live-status-time">· run {at}</span>
    </Link>
  );
}

function ThemeToggle() {
  const pref = useForecastStore((s) => s.theme);
  const setTheme = useForecastStore((s) => s.setTheme);
  const next = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
  const Icon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon;
  return (
    <button className="icon-btn" onClick={() => setTheme(next)} aria-label={`Theme: ${pref}. Switch to ${next}`} title={`Theme: ${pref}`}>
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={pref} initial={{ rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 60, opacity: 0 }} transition={{ duration: 0.18 }} style={{ display: 'grid' }}>
          <Icon size={17} />
        </m.span>
      </AnimatePresence>
    </button>
  );
}

function NavLinks({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  return (
    <>
      {nav.map(({ to, label }) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className="nav-link">
          {({ isActive }) => (
            <>
              {isActive && <m.span layoutId={mobile ? 'nav-pill-m' : 'nav-pill'} className="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="nav-text">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

export default function App() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useResolvedTheme();
  const meta = useMeta();
  const { date, setDate } = useForecastStore();

  // Default to the latest available forecast date once the API reports its range.
  useEffect(() => {
    const dates = meta.data?.dates;
    if (dates?.length && !dates.includes(date)) setDate(dates[dates.length - 1]);
  }, [meta.data, date, setDate]);
  useEffect(() => { setMenuOpen(false); window.scrollTo({ top: 0 }); }, [location.pathname]);
  useEffect(() => {
    const label = nav.find((n) => n.to === location.pathname)?.label;
    document.title = label && label !== 'Overview' ? `${label} · MonsoonLens` : 'MonsoonLens · District rainfall forecasts';
  }, [location.pathname]);

  return (
    <div className="shell">
      <ForecastLocation />
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="MonsoonLens home"><Logo /><Wordmark /></Link>
          <nav className="nav" aria-label="Main"><NavLinks /></nav>
          <div className="topbar-actions">
            <LiveStatus />
            <ThemeToggle />
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <m.nav id="mobile-nav" className="mobile-nav" aria-label="Main" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }}>
              <div className="mobile-nav-inner"><NavLinks mobile onNavigate={() => setMenuOpen(false)} /></div>
            </m.nav>
          )}
        </AnimatePresence>
      </header>

      <main id="main" className="main">
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }}>
            <Suspense fallback={<div className="page"><LoadingBlock rows={6} /></div>}>
              <Routes location={location}>
                <Route path="/" element={<Overview />} />
                <Route path="/forecast" element={<ForecastPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/regimes" element={<RegimesPage />} />
                <Route path="/verification" element={<VerificationPage />} />
                <Route path="/method" element={<MethodPage />} />
                <Route path="/pipeline" element={<Navigate to="/method" replace />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </m.div>
        </AnimatePresence>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Link to="/" className="brand"><Logo /><Wordmark /></Link>
            <p>Regime-aware post-processing for district rainfall forecasts. Not an official forecast — for warnings, follow the India Meteorological Department.</p>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            {nav.slice(1).map(({ to, label }) => <Link key={to} to={to}>{label}</Link>)}
          </nav>
        </div>
        <div className="footer-credits">
          <span>Live raw rainfall: Open-Meteo global NWP (CC BY 4.0)</span>
          <span>District boundaries: datta07/INDIAN-SHAPEFILES (MIT)</span>
          <span>Correction trained and verified on a sample dataset</span>
        </div>
      </footer>
    </div>
  );
}
