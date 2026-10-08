import { describe, expect, it } from 'vitest';
import { applyEvents } from '../live/apply';
import { demoRace } from '../live/demo';
import { Detector } from '../live/detector';
import type { LiveEvent } from '../live/protocol';
import { demoPlan } from './demo';

/** The demo race as the helper plays it, starting at `start` (ms) */
function demoEvents(start: number): LiveEvent[] {
  const d = new Detector();
  const out: LiveEvent[] = [];
  for (const [t, s] of demoRace({ step: 0.5 })) out.push(...d.push(s, start + t * 1000));
  return out;
}

describe('demo plan', () => {
  const now = Date.parse('2026-10-08T20:00:00Z');

  it.each([
    ['right away', 0],
    ['50 minutes later', 50 * 60_000],
  ])('fills the first three stints when the demo starts %s', (_, delay) => {
    const plan = applyEvents(demoPlan(now), demoEvents(now + delay));
    expect(plan.stints.map((s) => s.actualLaps ?? null).slice(0, 4)).toEqual([6, 6, 6, null]);
    expect(plan.stints.filter((s) => s.actualEnd)).toHaveLength(3);
  });
});
