import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeHtml, get, rainBand, rainColor } from './lib';

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
