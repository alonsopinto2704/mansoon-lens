import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffColor, diffIndex, diffLabels, diffLegend, escapeHtml, get, levelFill, LEVELS, rainBand, rainColor, warningLevel } from './lib';

afterEach(() => vi.unstubAllGlobals());

describe('API and tooltip boundaries', () => {
  it('rejects HTML error pages and invalid successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 503 })));
    await expect(get('/meta')).rejects.toThrow('503');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>SPA fallback</html>')));
    await expect(get('/meta')).rejects.toThrow('invalid response');
  });

  it('preserves structured API errors and escapes untrusted tooltip labels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid date' }), { status: 400 })));
    await expect(get('/forecast')).rejects.toThrow('Invalid date');
    expect(escapeHtml('<img src="x"> & \'district\'')).toBe('&lt;img src=&quot;x&quot;&gt; &amp; &#39;district&#39;');
  });
});

describe('rainfall map colors', () => {
  it('moves each IMD heavy-rain cutoff into the next severity band', () => {
    expect(rainBand(64.4)).toBe(3);
    expect(rainBand(64.5)).toBe(4);
    expect(rainBand(115.6)).toBe(5);
    expect(rainBand(204.5)).toBe(6);
    expect(rainColor(64.4)).not.toBe(rainColor(64.5));
  });

  it('uses a distinct ramp for dark surfaces', () => {
    expect(rainColor(115.6, 'dark')).not.toBe(rainColor(115.6, 'light'));
  });
});

describe('change layer bins', () => {
  it('colours and legend labels stay aligned across the ±3 / ±15 mm cut-offs', () => {
    expect(diffIndex(-20)).toBe(0);
    expect(diffIndex(-4)).toBe(1);
    expect(diffIndex(0)).toBe(2);
    expect(diffIndex(4)).toBe(3);
    expect(diffIndex(20)).toBe(4);
    for (const theme of ['light', 'dark'] as const) {
      expect(diffLabels).toHaveLength(diffLegend(theme).length);
      expect(new Set(diffLabels).size).toBe(diffLabels.length);
      // each bin's colour is distinct from its neighbours so the legend keys stay tellable
      for (let i = 1; i < 5; i++) expect(diffLegend(theme)[i]).not.toBe(diffLegend(theme)[i - 1]);
    }
    for (const cut of [-20, -4, 0, 4, 20]) expect(diffColor(cut)).toBe(diffLegend('light')[diffIndex(cut)]);
  });
});

describe('IMD-scheme warning level', () => {
  const at = (p64: number, p115 = 0, p204 = 0) => warningLevel({ prob_64_5: p64, prob_115_6: p115, prob_204_5: p204 }).key;
  it('maps exceedance chances to green, yellow, orange and red at the documented cut-offs', () => {
    expect(at(0.29)).toBe('green');
    expect(at(0.3)).toBe('yellow');
    expect(at(0.59, 0.29)).toBe('yellow');
    expect(at(0.6)).toBe('orange');
    expect(at(0.1, 0.3)).toBe('orange');
    expect(at(0.9, 0.49, 0.29)).toBe('orange');
    expect(at(0.9, 0.5)).toBe('red');
    expect(at(0, 0, 0.3)).toBe('red');
  });
  it('lets only "no warning" recede on the map', () => {
    expect(levelFill(LEVELS[0])).not.toBe(LEVELS[0].color);
    expect(levelFill(LEVELS[3])).toBe(LEVELS[3].color);
  });
});
