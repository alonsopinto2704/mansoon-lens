import { z } from 'zod';

export const Forecast = z.object({
  district_id: z.string(), district: z.string(), state: z.string(), lat: z.number(), lon: z.number(),
  raw_mm: z.number(), served_mm: z.number(), corrected_p10: z.number(), corrected_p50: z.number(), corrected_p90: z.number(),
  dominant_regime: z.string(), gate_status: z.string(), value: z.number(),
  prob_64_5: z.number(), prob_115_6: z.number(), prob_204_5: z.number(),
});
export type Forecast = z.infer<typeof Forecast>;
export const ForecastList = z.object({ items: z.array(Forecast), total: z.number(), date: z.string(), lead: z.number(), layer: z.string() });
export type District = Forecast & { regime_probabilities: Record<string, number>; gate_reason: string; advisory: string; drivers: {name: string; value: number}[] };
export type Score = { rmse: number; bias: number; pod: number | null; far: number | null; csi: number | null; ets: number | null; hits: number; misses: number; false_alarms: number; correct_negatives: number; brier?: number; brier_skill?: number | null; fss: Record<'1' | '3' | '5', number | null> };
export type Verification = { training_rows: number; validation_rows: number; test_rows: number; regimes: string[]; thresholds: number[]; classifier: { confusion_matrix: number[][]; per_regime: {regime: string; precision: number; recall: number; support: number}[] }; scores: Record<string, Record<string, Record<string, Score>>>; gate: Record<string, {status: string; reason: string; events: number; confidence_intervals?: Record<string, [number, number]>}>; reliability: Record<string, {forecast: number; observed: number; count: number}[]> };

export async function get<T>(url: string): Promise<T> {
  const response = await fetch(`/api/v1${url}`);
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Unable to load data');
  return json as T;
}
export function mm(n: number) { return `${n.toFixed(1)} mm`; }
export function pct(n: number) { return `${Math.round(n * 100)}%`; }
export function rainColor(value: number, contrast = false) {
  if (value < 2) return contrast ? '#d9e6ec' : '#ecf3f2';
  if (value < 15) return contrast ? '#6bc6aa' : '#9ddbb6';
  if (value < 35) return '#d9c45b';
  if (value < 64.5) return '#e59a4d';
  if (value < 115.6) return '#d76654';
  if (value < 204.5) return '#a83c4b';
  return '#682d4c';
}
export const regimeColor: Record<string, string> = { Active: '#2d7f79', Break: '#b0a463', Depression: '#8d4662', Orographic: '#596ba1', Coastal: '#2d90ae', 'Western disturbance': '#8867a7' };
