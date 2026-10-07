// A real session recorded by the helper: offline testing at Silverstone in the
// BMW M4 GT3 EVO, then a short race with one pit stop for fuel.
import { describe, expect, it } from 'vitest';
import { samplePlan } from '../sample';
import { applyEvents } from './apply';
import { Detector } from './detector';
import raw from './fixtures/silverstone-race.jsonl?raw';
import type { LiveEvent, Sample } from './protocol';

const rows = raw
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { at: number; s: Sample });

describe('recorded Silverstone race', () => {
  const d = new Detector();
  const events: LiveEvent[] = [];
  for (const r of rows) events.push(...d.push(r.s, r.at));
  const of = (k: LiveEvent['kind']) => events.filter((e) => e.kind === k);

  it('finds the one real pit stop, not the switch from testing to the race', () => {
    const stops = of('pitExit').filter((e) => e.kind === 'pitExit' && e.stopped);
    expect(stops).toHaveLength(1);
    const stop = stops[0];
    expect(stop.lapsCompleted).toBe(2);
    expect(stop.kind === 'pitExit' && stop.stopSec).toBeCloseTo(93.8, 0);
  });

  it('times the green laps and measures fuel per lap', () => {
    const green = of('lap').filter((e) => e.kind === 'lap' && e.green);
    expect(green.map((e) => e.lapsCompleted)).toEqual([4, 5, 6, 7, 8]);
    for (const e of green) {
      expect(e.kind === 'lap' && e.lapTime).toBeGreaterThan(65);
      expect(e.kind === 'lap' && e.lapTime).toBeLessThan(68);
    }
    expect(d.state().avgLapTime).toBeCloseTo(65.9, 0);
    expect(d.state().fuelPerLap).toBeCloseTo(1.61, 1);
  });

  it('fills in the first stint of a plan for that race, and only that', () => {
    const plan = samplePlan();
    plan.stints.forEach((st) => ((st.actualEnd = undefined), (st.actualLaps = undefined)));
    plan.event.sessionStart = new Date(rows[0].at).toISOString();
    plan.event.greenFlagOffsetMin = 0;
    const p = applyEvents(plan, events);
    expect(p.stints[0].actualEnd).toBe(new Date(Date.parse(events.find((e) => e.kind === 'pitExit' && e.stopped)!.at)).toISOString());
    expect(p.stints[0].actualLaps).toBe(2);
    expect(p.stints.filter((st) => st.actualEnd)).toHaveLength(1);
  });
});
