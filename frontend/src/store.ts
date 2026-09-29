import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { Theme } from './lib';

type ThemePref = Theme | 'system';
export type Layer = 'corrected' | 'raw' | 'observed' | 'diff' | 'probability' | 'warning' | 'regime';
export type Source = 'live' | 'season';
type State = {
  source: Source; date: string; lead: number; layer: Layer; theme: ThemePref;
  setSource: (source: Source) => void; setDate: (date: string) => void; setLead: (lead: number) => void; setLayer: (layer: Layer) => void; setTheme: (theme: ThemePref) => void;
};

function storedTheme(): ThemePref {
  try {
    const value = localStorage.getItem('ml-theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export const useForecastStore = create<State>((set) => ({
  source: 'live', date: '', lead: 1, layer: 'corrected', theme: storedTheme(),
  setSource: (source) => set((s) => ({ source, layer: source === 'live' && s.layer === 'observed' ? 'corrected' : s.layer })), setDate: (date) => set({ date }), setLead: (lead) => set({ lead }), setLayer: (layer) => set({ layer }),
  setTheme: (theme) => {
    try { if (theme === 'system') localStorage.removeItem('ml-theme'); else localStorage.setItem('ml-theme', theme); } catch { /* storage unavailable */ }
    set({ theme });
  },
}));

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Resolves the user's preference against the OS setting and stamps it on <html>. */
export function useResolvedTheme(): Theme {
  const pref = useForecastStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => query().matches);
  useEffect(() => {
    const mq = query();
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
