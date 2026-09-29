import { describe, expect, it } from 'vitest';
import { toggleSaved } from './watchlist';
import { alertsCsv, compareAlerts, observationColor, rainColor, stateSummary, type Forecast } from './lib';
import { readForecastView } from './forecastUrl';

describe('forecast context and interpretation', () => {
  it('round-trips shared view choices and rejects malformed selections', () => {
    expect(readForecastView(new URLSearchParams('source=season&date=2025-07-01&lead=4&layer=observed')))
      .toEqual({ source: 'season', date: '2025-07-01', lead: 4, layer: 'observed' });
    expect(readForecastView(new URLSearchParams('source=bad&date=2025-99-01&lead=99&layer=bad'))).toEqual({});
    expect(readForecastView(new URLSearchParams('date=2025-02-30'))).toEqual({});
  });
  it('ranks by the selected chance in All mode, independently of warning colour', () => {
    const red = { district: 'A', prob_64_5: .9, prob_115_6: .7, prob_204_5: .1 } as Forecast;
    const orange = { district: 'B', prob_64_5: .8, prob_115_6: .4, prob_204_5: .2 } as Forecast;
    expect([red, orange].sort((a, b) => compareAlerts(a, b, 'prob_204_5', true))[0]).toBe(orange);
    expect([orange, red].sort((a, b) => compareAlerts(a, b, 'prob_204_5', false))[0]).toBe(red);
  });
  it('exports enough context to interpret a probability away from the website', () => {
    const row = { district_id: '1', district: '=test,"name"', state: 'State', prob_64_5: .4, prob_115_6: .2, prob_204_5: .1, served_mm: 45, raw_mm: 50, dominant_regime: 'Active', gate_status: 'Serving raw' } as Forecast;
    const csv = alertsCsv([row], 'prob_115_6', { date: '2025-07-01', lead: 3, source: 'synthetic_2025', fetchedAt: '' });
    expect(csv).toContain('"threshold_mm_per_24h","valid_date","lead_days","source","run_fetched_at_utc"');
    expect(csv).toContain('"0.2","115.6","2025-07-01","3","synthetic_2025",""');
    expect(csv).toContain('"\'=test,""name"""');
  });
  it('never paints a missing observation as dry rainfall in either theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(observationColor(null, theme)).not.toBe(rainColor(0, theme));
      expect(observationColor(0, theme)).toBe(rainColor(0, theme));
    }
  });
});

describe('saved districts', () => {
  it('toggles, keeps newest first and caps the list', () => {
    expect(toggleSaved(['a'], 'b')).toEqual(['b', 'a']);
    expect(toggleSaved(['b', 'a'], 'b')).toEqual(['a']);
    expect(toggleSaved(Array.from({ length: 8 }, (_, i) => `d${i}`), 'new')).toHaveLength(8);
  });
});

describe('state summary', () => {
  it('counts levels per state and ranks the most severe first', () => {
    const row = (state: string, p: number) => ({ state, prob_64_5: p, prob_115_6: 0, prob_204_5: 0 }) as Forecast;
    const summary = stateSummary([row('A', 0.35), row('A', 0), row('B', 0.65), row('C', 0)]);
    expect(summary.map((s) => s.state)).toEqual(['B', 'A']);
    expect(summary[1]).toEqual({ state: 'A', counts: [1, 1, 0, 0], total: 2 });
  });
});
