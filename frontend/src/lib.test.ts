import { describe, expect, it } from 'vitest';
import { rainColor } from './lib';

describe('rainfall map colors', () => {
  it('moves each IMD heavy-rain cutoff into the next severity band', () => {
    expect(rainColor(64.4)).toBe('#e59a4d');
    expect(rainColor(64.5)).toBe('#d76654');
    expect(rainColor(115.6)).toBe('#a83c4b');
    expect(rainColor(204.5)).toBe('#682d4c');
  });

  it('preserves severe-rain colors in high contrast mode', () => {
    expect(rainColor(115.6, true)).toBe(rainColor(115.6));
  });
});
