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
export type District = Forecast & { lead?: number; regime_probabilities: Record<string, number>; gate_reason: string; advisory: string; drivers: {name: string; value: number}[]; season?: { days: number; heavy_days: number; rmse_raw: number; rmse_served: number } };
export type Score = { rmse: number; bias: number; pod: number | null; far: number | null; csi: number | null; ets: number | null; hits: number; misses: number; false_alarms: number; correct_negatives: number; brier?: number; brier_skill?: number | null; fss: Record<'1' | '3' | '5', number | null> };
export type Verification = { subset_rows: Record<string, number>; delivered_evaluation: string; reliability_by_group: Record<string, Record<string, {forecast: number; observed: number; count: number}[]>>; training_rows: number; validation_rows: number; test_rows: number; regimes: string[]; thresholds: number[]; classifier: { confusion_matrix: number[][]; per_regime: {regime: string; precision: number; recall: number; support: number}[] }; scores: Record<string, Record<string, Record<string, Score>>>; gate: Record<string, Gate>; reliability: Record<string, {forecast: number; observed: number; count: number}[]> };
export type Gate = { status: string; reason: string; events: number; confidence_intervals?: Record<string, [number, number]> };
export type Meta = { dates: string[]; district_count: number; regimes?: string[]; thresholds?: number[] };

export type ProbabilityKey = 'prob_64_5' | 'prob_115_6' | 'prob_204_5';
export function compareAlerts(a: Forecast, b: Forecast, key: ProbabilityKey, byChance: boolean) {
  return (byChance ? 0 : LEVELS.indexOf(warningLevel(b)) - LEVELS.indexOf(warningLevel(a))) || b[key] - a[key] || a.district.localeCompare(b.district);
}

export function alertsCsv(rows: Forecast[], key: ProbabilityKey, context: { date: string; lead: number; source: string; fetchedAt: string }) {
  const escape = (value: string | number) => {
    const text = String(value);
    // Keep spreadsheet applications from treating district names as formulas.
    const safe = typeof value === 'string' && /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const threshold = key.slice(5).replace('_', '.');
  const header = ['district_id', 'district', 'state', 'level', 'action', 'probability_0_to_1', 'threshold_mm_per_24h', 'valid_date', 'lead_days', 'source', 'run_fetched_at_utc', 'served_mm_per_24h', 'raw_mm_per_24h', 'regime', 'correction'];
  return [header, ...rows.map((r) => {
    const level = warningLevel(r);
    return [r.district_id, r.district, r.state, level.name, level.action, r[key], threshold, context.date, context.lead, context.source, context.fetchedAt, r.served_mm, r.raw_mm, r.dominant_regime, r.gate_status];
  })].map((row) => row.map(escape).join(',')).join('\r\n');
}

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
/** Page-title date: "Wednesday, 30 September", with the year for past (held-out season) dates. */
export const titleDate = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });

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

// Sequential single-hue blue (reference ramp steps): near-zero recedes toward the surface, heavy rain
// (≥ 64.5 mm, step 400 and darker) stands out. Dark mode runs dark → light against the dark surface.
const rainRamp: Record<Theme, string[]> = {
  light: ['#edf3fa', '#cde2fb', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
  dark: ['#162538', '#1c3f6b', '#1f5596', '#3179cf', '#5598e7', '#9ec5f4', '#dce9fb'],
};
export function rainColor(value: number, theme: Theme = 'light') { return rainRamp[theme][rainBand(value)]; }
export const noObservationColor = (theme: Theme) => theme === 'dark' ? '#68625b' : '#bdb7ae';
export const observationColor = (value: number | null, theme: Theme) => value === null ? noObservationColor(theme) : rainColor(value, theme);
export const rainLegend = (theme: Theme) => rainRamp[theme];

// Diverging blue ↔ red with a neutral grey midpoint: drier (red) ← no change → wetter (blue).
const diffRamp: Record<Theme, string[]> = {
  light: ['#b83a37', '#eba59c', '#e9e6df', '#9ec5f4', '#256abf'],
  dark: ['#e66767', '#7c3a36', '#383835', '#2d5f9f', '#86b6ef'],
};
export const diffLabels = ['Drier by 15+ mm', 'Drier by 3–15 mm', 'Within ±3 mm', 'Wetter by 3–15 mm', 'Wetter by 15+ mm'];
/** Bin for the served-vs-raw change (mm): [≤ −15 | −15..−3 | ±3 | 3..15 | ≥ 15]. */
export function diffIndex(value: number) {
  return value <= -15 ? 0 : value < -3 ? 1 : value <= 3 ? 2 : value < 15 ? 3 : 4;
}
export function diffColor(value: number, theme: Theme = 'light') {
  return diffRamp[theme][diffIndex(value)];
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
  light: { 'Regime-aware': '#2a78d6', Global: '#eb6834', Raw: '#1baf7a', Delivered: '#7156a5' },
  dark: { 'Regime-aware': '#3987e5', Global: '#d95926', Raw: '#199e70', Delivered: '#b49ade' },
};

// Sequential warm ramp for heavy-rain chance (5 bins).
export const probBins = [0.1, 0.3, 0.5, 0.7, Infinity];
export const probLabels = ['< 10%', '10–30%', '30–50%', '50–70%', '≥ 70%'];
// Second sequential context → its own single-hue ramp (orange), light → dark.
const probRamp: Record<Theme, string[]> = {
  light: ['#f6ede4', '#f7caa6', '#ef9a63', '#dc6a2e', '#a3421b'],
  dark: ['#2c2119', '#693a20', '#a8552a', '#e07a45', '#f6b489'],
};
export function probColor(p: number, theme: Theme = 'light') { return probRamp[theme][probBins.findIndex((b) => p < b)]; }
export const probLegend = (theme: Theme) => probRamp[theme];

/**
 * Colour-coded risk in the IMD warning scheme, derived from MonsoonLens exceedance probabilities.
 * Not an official IMD warning. Rule (documented on the How it works page):
 *   Red    — P(≥115.6 mm) ≥ 50% or P(≥204.5 mm) ≥ 30%
 *   Orange — P(≥64.5 mm) ≥ 60% or P(≥115.6 mm) ≥ 30%
 *   Yellow — P(≥64.5 mm) ≥ 30%
 *   Green  — otherwise
 */
export const LEVELS = [
  { key: 'green', name: 'Green', label: 'No warning', action: 'No action needed', color: '#0ca30c' },
  { key: 'yellow', name: 'Yellow', label: 'Watch', action: 'Be aware', color: '#fab219' },
  { key: 'orange', name: 'Orange', label: 'Alert', action: 'Be prepared', color: '#ec835a' },
  { key: 'red', name: 'Red', label: 'Warning', action: 'Take action', color: '#d03b3b' },
] as const;
export type Level = (typeof LEVELS)[number];
/** Map fill: "no warning" recedes to a soft tint so the alert colours carry the map. */
export function levelFill(level: Level, theme: Theme = 'light') {
  return level.key === 'green' ? (theme === 'dark' ? '#1f3a2a' : '#d9ecdc') : level.color;
}
export function warningLevel(i: { prob_64_5: number; prob_115_6: number; prob_204_5: number }): Level {
  if (i.prob_115_6 >= 0.5 || i.prob_204_5 >= 0.3) return LEVELS[3];
  if (i.prob_64_5 >= 0.6 || i.prob_115_6 >= 0.3) return LEVELS[2];
  if (i.prob_64_5 >= 0.3) return LEVELS[1];
  return LEVELS[0];
}
