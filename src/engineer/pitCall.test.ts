import { describe, expect, it } from 'vitest';
import { compute } from '../engine';
import { demoRace } from '../live/demo';
import type { Sample } from '../live/protocol';
import { demoPlan } from '../samples/demo';
import { replay } from '../strategy/replay';
import { pitCall, type PitCall } from './pitCall';

const T0 = Date.parse('2026-10-08T20:00:00Z');
function* timed(): Generator<[number, Sample]> {
  for (const [t, s] of demoRace()) yield [T0 + t * 1000, s];
}

describe('pit call on the demo race', () => {
  const calls = new Map<number, PitCall>();
  for (const st of replay(timed(), demoPlan(T0))) if (st.race) calls.set(st.race.lapsCompleted, pitCall(st.plan, compute(st.plan), st.race));
  const list = [...calls.values()];

  it('makes a call on every lap out on track', () => {
    expect(list.length).toBeGreaterThan(30);
    for (const c of list) if (!c.onPitRoad) expect(c.call).toBeTruthy();
  });

  it('says box this lap on the lap before a planned stop', () => {
    const boxes = list.filter((c) => c.boxThisLap).map((c) => c.lapsCompleted);
    expect(boxes.length).toBeGreaterThan(0);
    // The demo's first stop is after lap 6
    expect(boxes).toContain(5);
  });

  it('fills a full tank mid-race and only a splash near the end', () => {
    const early = calls.get(3)!;
    expect(early.addIsFull).toBe(true);
    expect(early.addAtStopL).toBeGreaterThan(10);
    const last = list.filter((c) => c.isFinalStint)[0];
    expect(last.stopLap).toBeNull();
    expect(last.toFlagL).toBe(0);
  });

  it('knows who drives next', () => {
    expect(calls.get(3)!.nextDriver).toBe('Driver B');
  });
});
