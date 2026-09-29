import { useEffect, useState } from 'react';
import { NavLink, Link, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Bell, ChartNoAxesCombined, CloudRain, Database, FileText, Layers3, Map, Menu, MoveUpRight, UploadCloud, Workflow, X } from 'lucide-react';
import { get, type Verification } from './lib';
import { useForecastStore } from './store';
import { Landing, ForecastPage, RegimesPage, AlertsPage, VerificationPage, PipelinePage, MethodPage, UploadPage } from './pages';

const nav = [
  {to: '/', label: 'Overview', icon: Activity}, {to: '/forecast', label: 'Forecast map', icon: Map},
  {to: '/regimes', label: 'Regime explorer', icon: Layers3}, {to: '/alerts', label: 'Heavy-rain alerts', icon: Bell},
  {to: '/verification', label: 'Verification', icon: ChartNoAxesCombined}, {to: '/pipeline', label: 'Pipeline', icon: Workflow},
  {to: '/method', label: 'Data & method', icon: Database}, {to: '/upload', label: 'Upload forecast', icon: UploadCloud},
];

export default function App() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const contrast = useForecastStore((s) => s.contrast);
  const toggleContrast = useForecastStore((s) => s.toggleContrast);
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => get<{dates: string[]; district_count: number}>('/meta') });
  const verification = useQuery({ queryKey: ['verification'], queryFn: () => get<Verification>('/verification') });
  useEffect(() => setMenuOpen(false), [location.pathname]);
  return <div className="app-shell" data-contrast={contrast}>
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <Link to="/" className="brand" aria-label="MonsoonLens home"><span className="brand-mark"><CloudRain size={23}/></span><span><strong>MONSOON<span>LENS</span></strong><small>RAIN INTELLIGENCE</small></span></Link>
      <div className="sidebar-divider" />
      <p className="nav-caption">WORKSPACE</p>
      <nav aria-label="Main navigation">{nav.map(({to, label, icon: Icon}) => <NavLink to={to} end={to === '/'} key={to} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18}/><span>{label}</span><ArrowRight className="nav-arrow" size={15}/></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-bottom-icon"><FileText size={18}/></div><div><strong>Research demo</strong><p>Synthetic monsoon seasons<br/>2021–2025</p></div></div>
    </aside>
    {menuOpen && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="main-shell">
      <div className="demo-banner">Demo running on synthetic data. Not an operational forecast.</div>
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button><div className="breadcrumbs"><span>MONSOONLENS</span><span>/</span><strong>{nav.find((n) => n.to === location.pathname)?.label ?? 'Overview'}</strong></div><div className="topbar-right"><span className="live-dot"/> <span>2025 TEST SEASON</span><button className="contrast-button" onClick={toggleContrast} aria-pressed={contrast}>High contrast {contrast ? 'on' : 'off'}</button></div></header>
      <main><Routes><Route path="/" element={<Landing verification={verification.data} meta={meta.data}/>} /><Route path="/forecast" element={<ForecastPage meta={meta.data}/>} /><Route path="/regimes" element={<RegimesPage verification={verification.data}/>} /><Route path="/alerts" element={<AlertsPage/>} /><Route path="/verification" element={<VerificationPage verification={verification.data} loading={verification.isLoading} error={verification.error}/>} /><Route path="/pipeline" element={<PipelinePage/>} /><Route path="/method" element={<MethodPage/>} /><Route path="/upload" element={<UploadPage/>} /></Routes></main>
      <footer className="footer"><span>SIH 2026 · PS 26080 · Team Code Stormers</span><span>MONSOONLENS <MoveUpRight size={12}/></span></footer>
    </div>
  </div>;
}
