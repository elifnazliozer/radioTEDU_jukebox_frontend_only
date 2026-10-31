import { useEffect, useState } from 'react';

// Same picker as the kiosk (kiosk-web/kiosk-extras.js), so both screens tint to the same
// colour for a song. Colours are "r, g, b" strings, ready for rgb(...) in CSS.

const HUE_BUCKETS = 12;
const SAMPLE_SIZE = 24;

/** Dominant colourful hue of a cover (RGBA pixel data); grey, black and white are ignored. */
export function pickAmbientColor(pixels: ArrayLike<number>): string | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ r: 0, g: 0, b: 0, count: 0, weight: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const pr = pixels[i];
    const pg = pixels[i + 1];
    const pb = pixels[i + 2];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    if (pixels[i + 3] < 128 || max < 40 || min > 225 || max - min < 40) continue;
    const delta = max - min;
    let hue;
    if (max === pr) hue = ((pg - pb) / delta + 6) % 6;
    else if (max === pg) hue = (pb - pr) / delta + 2;
    else hue = (pr - pg) / delta + 4;
    const bucket = buckets[Math.floor((hue / 6) * HUE_BUCKETS) % HUE_BUCKETS];
    bucket.r += pr;
    bucket.g += pg;
    bucket.b += pb;
    bucket.count += 1;
    bucket.weight += delta / max;
  }
  const best = buckets.reduce((top, bucket) => (bucket.weight > top.weight ? bucket : top));
  if (best.count === 0) return null;
  return `${Math.round(best.r / best.count)}, ${Math.round(best.g / best.count)}, ${Math.round(best.b / best.count)}`;
}

/** Clamps saturation and lightness so any cover colour reads well behind white text. */
export function tuneAmbientColor(rgb: string): string {
  const [r, g, b] = rgb.split(',').map((part) => Number(part) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const s = Math.min(Math.max(saturation, 0.45), 0.85);
  const l = Math.min(Math.max(lightness, 0.38), 0.52);

  // HSL back to RGB.
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const sextants: [number, number, number][] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const [r1, g1, b1] = sextants[Math.floor(hue) % 6];
  const m = l - chroma / 2;
  return [r1, g1, b1].map((value) => Math.round((value + m) * 255)).join(', ');
}

/**
 * Tint colour for a cover, or null while loading, without a cover, or when the cover host
 * blocks reading pixels (no CORS) — callers then keep the brand colour.
 */
export function useAlbumColor(coverUrl: string | null | undefined): string | null {
  const [result, setResult] = useState<{ url: string; color: string | null } | null>(null);

  useEffect(() => {
    if (!coverUrl || typeof Image === 'undefined') return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      let color: string | null = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          const picked = pickAmbientColor(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
          color = picked && tuneAmbientColor(picked);
        }
      } catch {
        color = null;
      }
      setResult({ url: coverUrl, color });
    };
    img.onerror = () => {
      if (!cancelled) setResult({ url: coverUrl, color: null });
    };
    img.src = coverUrl;
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return coverUrl && result?.url === coverUrl ? result.color : null;
}
