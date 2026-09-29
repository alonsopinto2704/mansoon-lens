import { describe, expect, it } from 'vitest';
import { rainBand, rainColor } from './lib';

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
