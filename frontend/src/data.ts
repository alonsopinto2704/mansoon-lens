import { useQuery } from '@tanstack/react-query';
import { get, type District, type ForecastList, type Meta, type Verification } from './lib';
import { useForecastStore } from './store';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => get<Meta>('/meta'), staleTime: Infinity });
export const useVerification = () => useQuery({ queryKey: ['verification'], queryFn: () => get<Verification>('/verification'), staleTime: Infinity });

export type LiveList = { items: District[]; total: number; lead: number; date: string | null; status: 'fetching' | 'ready' | 'error' | 'idle'; error: string | null; fetched_at?: string; dates?: string[]; source?: string };

/** Live NWP run for the selected lead. Polls while the server is still fetching. */
export function useLive(enabled = true) {
  const lead = useForecastStore((s) => s.lead);
  return useQuery({
    queryKey: ['live', lead],
    queryFn: () => get<LiveList>(`/live?lead=${lead}`),
    enabled,
    refetchInterval: (q) => (q.state.data?.status === 'fetching' || q.state.data?.status === 'idle' ? 5000 : 10 * 60 * 1000),
  });
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
