// Draws the track for the Race engineer map from one clean lap of the car you are driving:
// speed and heading, added up step by step, give the line the car took. iRacing doesn't
// hand out track shapes, so this is how the map learns a track; it is saved and reused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalise } from '../../src/live/field.ts';

/** Points in a finished outline, evenly spaced around the lap */
export const OUTLINE_POINTS = 300;

interface Step {
  pct: number;
  x: number;
  y: number;
}

export class OutlineRecorder {
  private steps: Step[] = [];
  private x = 0;
  private y = 0;
  private prev: { pct: number; t: number } | null = null;
  private recording = false;

  /** Feed one reading of the driven car. Returns a finished outline after a clean lap. */
  push(pct: number, speed: number, yaw: number, onPitRoad: boolean, t: number): number[] | null {
    const p = this.prev;
    this.prev = { pct, t };
    if (!p || pct < 0) return null;
    const dt = t - p.t;
    // Pit lane, a long pause, a jump (tow, reset) or reversing spoil the lap
    if (onPitRoad || dt <= 0 || dt > 1 || (pct - p.pct + 1) % 1 > 0.05) {
      this.recording = false;
      return null;
    }
    this.x += speed * Math.cos(yaw) * dt;
    this.y += speed * Math.sin(yaw) * dt;
    const crossed = pct < 0.1 && p.pct > 0.9;
    if (crossed) {
      const done = this.recording && this.steps.length >= 100 ? finish([...this.steps, { pct: pct + 1, x: this.x, y: this.y }]) : null;
      this.recording = true;
      this.steps = [{ pct, x: this.x, y: this.y }];
      return done;
    }
    if (this.recording) this.steps.push({ pct, x: this.x, y: this.y });
    return null;
  }
}

/** Closes the loop (spreading the small drift over the lap) and resamples it at even steps */
export function finish(steps: Step[]): number[] | null {
  const first = steps[0];
  const last = steps[steps.length - 1];
  const span = last.pct - first.pct;
  if (span < 0.98) return null;
  const ex = last.x - first.x;
  const ey = last.y - first.y;
  const fixed = steps.map((s) => {
    const f = (s.pct - first.pct) / span;
    return { pct: s.pct, x: s.x - ex * f, y: s.y - ey * f };
  });
  const pts: [number, number][] = [];
  for (let k = 0; k < OUTLINE_POINTS; k++) {
    // Point k sits at k / OUTLINE_POINTS of the lap; the recorded lap may start just after the line
    let pct = k / OUTLINE_POINTS;
    if (pct < first.pct) pct += 1;
    let lo = 0;
    let hi = fixed.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fixed[mid].pct <= pct) lo = mid;
      else hi = mid;
    }
    const a = fixed[lo];
    const b = fixed[hi];
    const f = Math.max(0, Math.min(1, (pct - a.pct) / (b.pct - a.pct || 1)));
    // Screen y points down, so flip it to keep the track the right way round
    pts.push([a.x + (b.x - a.x) * f, -(a.y + (b.y - a.y) * f)]);
  }
  return normalise(pts);
}

/** Saved outlines, one file per track */
export class OutlineStore {
  constructor(private dir: string) {}
  private file = (track: string) => join(this.dir, `${track.replace(/[^\w-]+/g, '_') || 'track'}.json`);
  load(track: string): number[] | null {
    try {
      const f = this.file(track);
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as number[]) : null;
    } catch {
      return null;
    }
  }
  save(track: string, points: number[]) {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file(track), JSON.stringify(points));
    } catch {
      /* not fatal: it is drawn again next lap */
    }
  }
}
