import { describe, expect, it } from 'vitest';
import { compute } from '../engine';
import { applyEvents } from '../live/apply';
import { demoRace } from '../live/demo';
import { Detector } from '../live/detector';
import type { LiveEvent } from '../live/protocol';
import { demoPlan } from './demo';

/** The demo race as the helper plays it, starting at `start` (ms) */
function demoEvents(start: number): LiveEvent[] {
  const d = new Detector();
  const out: LiveEvent[] = [];
  for (const [t, s] of demoRace()) out.push(...d.push(s, start + t * 1000));
  return out;
}

describe('demo plan', () => {
  const now = Date.parse('2026-10-08T20:00:00Z');

  it.each([
    ['right away', 0],
    ['5 minutes earlier', -5 * 60_000],
    ['50 minutes later', 50 * 60_000],
    ['a day later', 24 * 3600_000],
  ])('fills every stop when the demo starts %s', (_, delay) => {
    const plan = applyEvents(demoPlan(now), demoEvents(now + delay));
    const stints = compute(plan).stints;
    // Laps per stint: on plan, on plan, a lap long, on plan, a lap short
    expect(plan.stints.map((s) => s.actualLaps ?? null)).toEqual([6, 6, 7, 6, 5, null]);
    // Each stop against the plan as it stood (seconds): a bit ahead, a slower driver,
    // a lap later, a safety car and a slow stop, and a stop a lap early
    expect(stints.slice(0, 5).map((s) => Math.round(s.deltaSec ?? NaN))).toEqual([-3, 10, 107, 212, -79]);
    // The last stint runs to the flag
    expect(stints[5].isFinal).toBe(true);
  });
});
