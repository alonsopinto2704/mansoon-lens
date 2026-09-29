import { useQuery } from '@tanstack/react-query';
import { get, type ForecastList, type Meta, type Verification } from './lib';
import { useForecastStore } from './store';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => get<Meta>('/meta'), staleTime: Infinity });
export const useVerification = () => useQuery({ queryKey: ['verification'], queryFn: () => get<Verification>('/verification'), staleTime: Infinity });

/** Forecast rows for the selected date and lead. Waits until a valid date is known. */
export function useForecast(layer: 'raw' | 'corrected' | 'diff' = 'corrected') {
  const { date, lead } = useForecastStore();
  return useQuery({
    queryKey: ['forecast', date, lead, layer],
    queryFn: () => get<ForecastList>(`/forecast?date=${date}&lead=${lead}&layer=${layer}&per_page=700`),
    enabled: Boolean(date),
    placeholderData: (prev) => prev,
  });
}
