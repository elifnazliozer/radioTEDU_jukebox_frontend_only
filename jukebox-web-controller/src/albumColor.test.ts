import { describe, expect, it } from 'vitest';
import { pickAmbientColor, tuneAmbientColor } from './albumColor';

const pixel = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

describe('pickAmbientColor', () => {
  it('averages the colourful pixels and ignores grey, black and white', () => {
    const pixels = [
      ...pixel(200, 40, 40),
      ...pixel(220, 60, 20),
      ...pixel(128, 128, 128),
      ...pixel(5, 5, 5),
      ...pixel(250, 250, 250),
    ];
    expect(pickAmbientColor(pixels)).toBe('210, 50, 30');
  });

  it('returns null for a cover with no usable colour', () => {
    expect(pickAmbientColor([...pixel(10, 10, 10), ...pixel(240, 240, 240)])).toBeNull();
  });

  it('picks the dominant hue instead of mixing hues into mud', () => {
    const pixels = [...pixel(30, 60, 200), ...pixel(40, 70, 210), ...pixel(35, 65, 205), ...pixel(220, 180, 30)];
    expect(pickAmbientColor(pixels)).toBe('35, 65, 205');
  });
});

describe('tuneAmbientColor', () => {
  const lightness = (rgb: string) => {
    const [r, g, b] = rgb.split(',').map((part) => Number(part) / 255);
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  };

  it('keeps every tint in a range that reads well behind white text', () => {
    for (const color of ['250, 245, 240', '20, 10, 30', '125, 114, 56', '35, 65, 205']) {
      const tuned = lightness(tuneAmbientColor(color));
      expect(tuned).toBeGreaterThanOrEqual(0.37);
      expect(tuned).toBeLessThanOrEqual(0.53);
    }
  });

  it('matches the kiosk for the same cover colour', () => {
    // Value the kiosk's tuneAmbientColor produced for the "Strange Trails" cover.
    expect(tuneAmbientColor('125, 114, 56')).toBe('141, 127, 53');
  });
});
