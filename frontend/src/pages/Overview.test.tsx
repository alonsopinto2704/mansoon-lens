import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import Overview from './Overview';

const { useLive, useLiveRun } = vi.hoisted(() => ({ useLive: vi.fn(), useLiveRun: vi.fn() }));
vi.mock('../data', () => ({ useLive, useLiveRun, useVerification: () => ({ data: undefined, isError: false }) }));
vi.mock('../store', () => ({ useResolvedTheme: () => 'light', useForecastStore: (select: (state: { setSource: () => void }) => unknown) => select({ setSource: () => {} }) }));
vi.mock('../watchlist', () => ({ useSaved: (select: (state: { ids: string[]; toggle: () => void }) => unknown) => select({ ids: [], toggle: () => {} }) }));
vi.mock('../components/IndiaMap', () => ({ IndiaMap: () => <div>Map ready</div> }));

const render = () => renderToStaticMarkup(<StaticRouter location="/"><Overview /></StaticRouter>);

describe('homepage live forecast feedback', () => {
  beforeEach(() => {
    const run = { data: { items: [], status: 'fetching' }, isError: false, isPending: false, refetch: vi.fn() };
    useLive.mockReturnValue(run);
    useLiveRun.mockReturnValue(run);
  });

  it('shows an API-reported feed failure and retry instead of loading forever', () => {
    useLive.mockReturnValue({ data: { items: [], status: 'error', error: 'Feed unavailable' }, isError: false, refetch: vi.fn() });
    const html = render();
    expect(html).toContain('Feed unavailable');
    expect(html).toContain('Try again');
    expect(html).not.toContain('map-skeleton');
  });

  it('keeps the loading state while the feed is still being fetched', () => {
    expect(render()).toContain('map-skeleton');
  });

  it('shows a transport failure with retry', () => {
    useLive.mockReturnValue({ isError: true, error: new Error('Network failed'), refetch: vi.fn() });
    expect(render()).toContain('Network failed');
    expect(render()).toContain('Try again');
  });

  it('keeps usable cached forecasts visible after a refresh failure', () => {
    useLive.mockReturnValue({ data: { status: 'error', error: 'Refresh failed', items: [{ district_id: '1', district: 'Pune', state: 'Maharashtra', served_mm: 40, prob_64_5: 0.2, prob_115_6: 0.1, prob_204_5: 0.01 }] }, isError: false });
    expect(render()).toContain('Map ready');
    expect(render()).not.toContain('Refresh failed');
  });
});
