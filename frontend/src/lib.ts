import { z } from 'zod';

export const Forecast = z.object({
  district_id: z.string(), district: z.string(), state: z.string(), lat: z.number(), lon: z.number(),
  raw_mm: z.number(), served_mm: z.number(), corrected_p10: z.number(), corrected_p50: z.number(), corrected_p90: z.number(),
  observed_mm: z.number().nullable(), dominant_regime: z.string(), gate_status: z.string(), value: z.number(),
  prob_64_5: z.number(), prob_115_6: z.number(), prob_204_5: z.number(),
});
export type Forecast = z.infer<typeof Forecast>;
export const ForecastList = z.object({ items: z.array(Forecast), total: z.number(), date: z.string(), lead: z.number(), layer: z.string() });
export type ForecastList = z.infer<typeof ForecastList>;
export type District = Forecast & { regime_probabilities: Record<string, number>; gate_reason: string; advisory: string; drivers: {name: string; value: number}[]; season?: { days: number; heavy_days: number; rmse_raw: number; rmse_served: number } };
export type Score = { rmse: number; bias: number; pod: number | null; far: number | null; csi: number | null; ets: number | null; hits: number; misses: number; false_alarms: number; correct_negatives: number; brier?: number; brier_skill?: number | null; fss: Record<'1' | '3' | '5', number | null> };
export type Verification = { training_rows: number; validation_rows: number; test_rows: number; regimes: string[]; thresholds: number[]; classifier: { confusion_matrix: number[][]; per_regime: {regime: string; precision: number; recall: number; support: number}[] }; scores: Record<string, Record<string, Record<string, Score>>>; gate: Record<string, Gate>; reliability: Record<string, {forecast: number; observed: number; count: number}[]> };
export type Gate = { status: string; reason: string; events: number; confidence_intervals?: Record<string, [number, number]> };
export type Meta = { dates: string[]; district_count: number; regimes?: string[]; thresholds?: number[] };
export type Alert = { district_id: string; district: string; state: string; probability: number; dominant_regime: string; gate_status: string; served_mm: number };

export async function get<T>(url: string): Promise<T> {
  const response = await fetch(`/api/v1${url}`);
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof json?.error === 'string' ? json.error : `Unable to load data (${response.status}). Please try again.`);
  if (json === null || typeof json !== 'object') throw new Error('The server returned an invalid response. Please try again.');
  return json as T;
}

/** Leaflet tooltips accept HTML; API labels must remain plain text. */
export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export const mm = (n: number) => `${n.toFixed(1)} mm`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const fixed = (n: number | null | undefined, digits = 2) => (typeof n === 'number' ? n.toFixed(digits) : '—');
export const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export type Theme = 'light' | 'dark';

const reasonTerms: Record<string, string> = { raw_rmse: 'RMSE vs raw', global_rmse: 'RMSE vs global fix', raw_csi: 'CSI vs raw', global_csi: 'CSI vs global fix' };
/** Turns backend gate reasons ("No verified improvement in global_rmse, raw_csi") into plain language. */
export function gateReason(reason: string) {
  return reason.replace(/\b(raw|global)_(rmse|csi)\b/g, (t) => reasonTerms[t] ?? t);
}

/** IMD 24-hour rainfall categories (mm/day). Band index is used for colour and labels. */
export const rainBands = [
  { max: 2.5, label: 'Very light' },
  { max: 15.6, label: 'Light' },
  { max: 35.6, label: 'Moderate' },
  { max: 64.5, label: 'Rather heavy' },
  { max: 115.6, label: 'Heavy' },
  { max: 204.5, label: 'Very heavy' },
  { max: Infinity, label: 'Extremely heavy' },
] as const;
export function rainBand(value: number) { return rainBands.findIndex((b) => value < b.max); }

// Sequential single-hue ramps (light → dark on light surfaces, dark → light on dark surfaces).
const rainRamp: Record<Theme, string[]> = {
  light: ['#eef4fb', '#cfe0f5', '#a3c5ec', '#6fa3df', '#3f7fcf', '#2459a8', '#173a74'],
  dark: ['#1d2c44', '#22406b', '#2d5b97', '#437bc4', '#6c9fe0', '#a3c4f0', '#dde9fb'],
};
export function rainColor(value: number, theme: Theme = 'light') { return rainRamp[theme][rainBand(value)]; }
export const rainLegend = (theme: Theme) => rainRamp[theme];

// Diverging: drier (orange) ← neutral → wetter (blue).
const diffRamp: Record<Theme, string[]> = {
  light: ['#b9531f', '#eab08a', '#d7dbe0', '#8fb5e6', '#2a68c0'],
  dark: ['#d9692f', '#8a5234', '#3a4353', '#335c93', '#6ea3ec'],
};
export function diffColor(value: number, theme: Theme = 'light') {
  const i = value <= -15 ? 0 : value < -3 ? 1 : value <= 3 ? 2 : value < 15 ? 3 : 4;
  return diffRamp[theme][i];
}
export const diffLegend = (theme: Theme) => diffRamp[theme];

// Validated categorical order (fixed slots, never cycled). Regime names are always labelled beside their colour.
const regimeSlots: Record<Theme, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
};
export const REGIMES = ['Active', 'Break', 'Depression', 'Orographic', 'Coastal', 'Western disturbance'];
export function regimeColor(name: string, theme: Theme = 'light') {
  const i = REGIMES.indexOf(name);
  return regimeSlots[theme][i < 0 ? 0 : i];
}
export const regimeBlurb: Record<string, string> = {
  Active: 'Strong monsoon flow with widespread, persistent rain.',
  Break: 'Weak monsoon trough; long dry spells with isolated showers.',
  Depression: 'Low-pressure systems driving intense, organised rainfall.',
  Orographic: 'Moist winds lifted by terrain, concentrating rain on slopes.',
  Coastal: 'Rain focused along the coast from offshore troughs and vortices.',
  'Western disturbance': 'Mid-latitude troughs interacting with monsoon moisture in the north.',
};

/** Series colours for the three-model comparison (first three validated slots). */
export const modelColors: Record<Theme, Record<string, string>> = {
  light: { 'Regime-aware': '#2a78d6', Global: '#eb6834', Raw: '#1baf7a' },
  dark: { 'Regime-aware': '#3987e5', Global: '#d95926', Raw: '#199e70' },
};

// Sequential warm ramp for heavy-rain chance (5 bins).
export const probBins = [0.1, 0.3, 0.5, 0.7, Infinity];
export const probLabels = ['< 10%', '10–30%', '30–50%', '50–70%', '≥ 70%'];
const probRamp: Record<Theme, string[]> = {
  light: ['#f6efe6', '#f5cf9f', '#ee9a55', '#d4582a', '#8f2a14'],
  dark: ['#2a2420', '#6b4424', '#b1622c', '#e3854a', '#f7c59a'],
};
export function probColor(p: number, theme: Theme = 'light') { return probRamp[theme][probBins.findIndex((b) => p < b)]; }
export const probLegend = (theme: Theme) => probRamp[theme];
