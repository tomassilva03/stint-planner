// Small robust statistics for the live estimator. Pure and deterministic.

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation scaled to match a standard deviation for normal data */
export function robustSpread(xs: number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)))!;
}

/**
 * Mean after dropping outliers: points further than `k` robust spreads from the
 * median. `floor` keeps a tiny spread (very steady laps) from rejecting everything.
 */
export function robustMean(xs: number[], k = 3, floor = 0): number | null {
  const m = median(xs);
  if (m == null) return null;
  const limit = Math.max(k * robustSpread(xs)!, floor);
  const kept = xs.filter((x) => Math.abs(x - m) <= limit);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Theil–Sen slope: the median of all pairwise slopes, so one odd point barely moves it */
export function theilSen(points: [number, number][]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j][0] - points[i][0];
      if (dx !== 0) slopes.push((points[j][1] - points[i][1]) / dx);
    }
  return median(slopes);
}

/** Standard normal cumulative probability */
export function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
