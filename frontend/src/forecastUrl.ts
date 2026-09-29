import type { Layer, Source } from './store';

export function readForecastView(params: URLSearchParams) {
  const source = params.get('source');
  const lead = Number(params.get('lead'));
  const date = params.get('date') ?? '';
  const layer = params.get('layer');
  return {
    ...(source === 'live' || source === 'season' ? { source: source as Source } : {}),
    ...(Number.isInteger(lead) && lead >= 1 && lead <= 5 ? { lead } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? { date } : {}),
    ...(['corrected', 'raw', 'observed', 'diff', 'probability', 'warning', 'regime'].includes(layer ?? '') ? { layer: layer as Layer } : {}),
  };
}
