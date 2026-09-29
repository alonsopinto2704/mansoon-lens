import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, warningLevel, type District, type ForecastList, type Meta, type Verification } from './lib';
import { useForecastStore } from './store';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => get<Meta>('/meta'), staleTime: Infinity });
export const useVerification = () => useQuery({ queryKey: ['verification'], queryFn: () => get<Verification>('/verification'), staleTime: Infinity });

export type LiveList = { items: District[]; total: number; lead: number; date: string | null; status: 'fetching' | 'ready' | 'error' | 'idle'; error: string | null; fetched_at?: string; dates?: string[]; source?: string };

/**
 * Live NWP run for the selected lead. Paints instantly from the last cached run (`?cached=1` never waits
 * on Open-Meteo) while the full request refreshes in the background, then swaps in the newer run.
 * Both responses hold all five lead days, so the CDN keeps one copy.
 */
export function useLive(enabled = true) {
  const lead = useForecastStore((s) => s.lead);
  const select = useCallback((d: LiveList): LiveList => {
    const items = d.items.filter((i) => (i as District & { lead: number }).lead === lead);
    return { ...d, lead, items, total: items.length, date: d.dates?.[lead - 1] ?? null };
  }, [lead]);
  const cached = useQuery({ queryKey: ['live', 'cached'], queryFn: () => get<LiveList>('/live?cached=1'), select, enabled, retry: false, staleTime: 5 * 60 * 1000 });
  const fresh = useQuery({ queryKey: ['live'], queryFn: () => get<LiveList>('/live'), select, enabled, retry: 1, refetchInterval: 15 * 60 * 1000 });
  const newer = (a?: LiveList, b?: LiveList) => (a?.fetched_at ?? '') >= (b?.fetched_at ?? '');
  const useFresh = Boolean(fresh.data?.items.length) && newer(fresh.data, cached.data);
  if (useFresh || !cached.data?.items.length) return { ...fresh, refreshing: false };
  // Showing the cached run: a failed refresh is reported as a status, not as a page error.
  const data = fresh.isError || fresh.data?.status === 'error' ? { ...cached.data, status: 'error' as const } : cached.data;
  return { ...cached, data, refreshing: fresh.isFetching };
}

export type DaySummary = { lead: number; date: string | null; districts: number; heavy: number; alerts: number; maxMm: number };

/** Per-lead headline numbers for the day strip, from whichever live run (fresh or cached) is newest. Shares the live query cache. */
export function useLiveDays(enabled = true) {
  const summarize = useCallback((d: LiveList): DaySummary[] => [1, 2, 3, 4, 5].map((lead) => {
    const rows = d.items.filter((i) => (i as District & { lead: number }).lead === lead);
    return { lead, date: d.dates?.[lead - 1] ?? null, districts: rows.length, heavy: rows.filter((i) => i.served_mm >= 64.5).length,
      alerts: rows.filter((i) => warningLevel(i).key === 'orange' || warningLevel(i).key === 'red').length, maxMm: Math.max(0, ...rows.map((i) => i.served_mm)) };
  }), []);
  const cached = useQuery({ queryKey: ['live', 'cached'], queryFn: () => get<LiveList>('/live?cached=1'), select: summarize, enabled, retry: false, staleTime: 5 * 60 * 1000 });
  const fresh = useQuery({ queryKey: ['live'], queryFn: () => get<LiveList>('/live'), select: summarize, enabled, retry: 1, refetchInterval: 15 * 60 * 1000 });
  return fresh.data?.some((d) => d.districts) ? fresh.data : cached.data;
}

/** Held-out season rows for the selected date and lead (every map layer is derived client-side). */
function useSeason(enabled: boolean) {
  const { date, lead } = useForecastStore();
  return useQuery({
    queryKey: ['forecast', date, lead],
    queryFn: () => get<ForecastList>(`/forecast?date=${date}&lead=${lead}&per_page=1000`),
    enabled: enabled && Boolean(date),
  });
}

/** District rows from the selected source: live NWP or the verified held-out season. */
export function useForecast() {
  const source = useForecastStore((s) => s.source);
  const live = useLive(source === 'live');
  const season = useSeason(source === 'season');
  return source === 'live' ? live : season;
}
