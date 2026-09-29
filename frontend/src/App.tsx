import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { Menu, Monitor, Moon, Sun, X } from 'lucide-react';
import { useMeta } from './data';
import { useForecastStore, useResolvedTheme } from './store';
import { LoadingBlock, ease } from './components/ui';

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
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <circle cx="16" cy="14" r="7" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="14" r="2.5" fill="#fff" />
      <path d="M11 24.5l1-2M16 26l1-2M21 24.5l1-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="MonsoonLens home"><Logo /><span>MonsoonLens</span></Link>
          <nav className="nav" aria-label="Main"><NavLinks /></nav>
          <div className="topbar-actions">
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
            <Link to="/" className="brand"><Logo /><span>MonsoonLens</span></Link>
            <p>Regime-aware post-processing for district rainfall forecasts. Live raw rainfall comes from Open-Meteo’s global NWP; the correction is trained and verified on a sample dataset. Not an official forecast — refer to IMD for warnings.</p>
          </div>
          <nav className="footer-nav" aria-label="Footer">
            {nav.slice(1).map(({ to, label }) => <Link key={to} to={to}>{label}</Link>)}
          </nav>
        </div>
      </footer>
    </div>
  );
}
