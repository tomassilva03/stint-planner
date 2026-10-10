import { describe, expect, it } from 'vitest';
import { simpleRace } from './demo';
import { Detector } from './detector';
import type { LiveEvent, Sample } from './protocol';

function run(samples: Iterable<[number, Sample]>, start = Date.UTC(2026, 0, 1, 12)) {
  const d = new Detector();
  const events: LiveEvent[] = [];
  for (const [t, s] of samples) events.push(...d.push(s, start + t * 1000));
  return { d, events };
}

describe('detector on the demo race', () => {
  const { d, events } = run(simpleRace({ lapTime: 100, lapsPerStint: 6, stints: 4, stopSec: 60 }));
  const of = (k: LiveEvent['kind']) => events.filter((e) => e.kind === k);

  it('finds the three real stops and the drive-through', () => {
    const exits = of('pitExit');
    expect(exits.map((e) => e.kind === 'pitExit' && e.stopped)).toEqual([true, true, false, true]);
    expect(exits.filter((e) => e.kind === 'pitExit' && e.stopped).map((e) => e.lapsCompleted)).toEqual([6, 12, 18]);
    const first = exits[0];
    expect(first.kind === 'pitExit' && first.stopSec).toBeGreaterThan(99);
    expect(of('pitEntry')).toHaveLength(4);
  });

  it('reports every lap once, with its time', () => {
    const laps = of('lap');
    expect(laps.map((l) => l.lapsCompleted)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(laps.map((l) => l.id)).size).toBe(24);
    expect(laps.every((l) => l.kind === 'lap' && l.lapTime != null && l.lapTime >= 100)).toBe(true);
  });

  it('measures fuel per lap from green laps only', () => {
    expect(d.state().fuelPerLap).toBeCloseTo(3, 1);
    expect(d.state().avgLapTime).toBeCloseTo(100, 1);
  });

  it('sees the caution and the driver swaps', () => {
    expect(of('cautionStart')).toHaveLength(1);
    expect(of('cautionEnd')).toHaveLength(1);
    expect(of('driverChange').map((e) => e.kind === 'driverChange' && e.driverName)).toEqual(['Driver B', 'Driver A', 'Driver B']);
  });

  it('gives the same ids on another PC that joined late', () => {
    const all = [...simpleRace({ lapTime: 100, lapsPerStint: 6, stints: 4, stopSec: 60 })];
    const late = run(all.slice(Math.floor(all.length / 2)));
    const lateExits = late.events.filter((e) => e.kind === 'pitExit').map((e) => e.id);
    const fullExits = of('pitExit').map((e) => e.id);
    expect(lateExits.length).toBeGreaterThan(0);
    for (const id of lateExits) expect(fullExits).toContain(id);
  });
});

describe('detector outside a race', () => {
  it('ignores pit stops in practice', () => {
    const practice = [...simpleRace({ stints: 2 })].map(([t, s]) => [t, { ...s, sessionType: 'Practice' }] as [number, Sample]);
    const { events } = run(practice);
    expect(events.filter((e) => e.kind !== 'lap')).toEqual([]);
  });

  it('starts over when the session changes', () => {
    const d = new Detector();
    const base = [...simpleRace({ stints: 2 })];
    for (const [t, s] of base) d.push(s, t * 1000);
    expect(d.history.length).toBeGreaterThan(0);
    d.push({ ...base[0][1], sessionNum: 3 }, 0);
    expect(d.history).toEqual([]);
  });
});

describe('detector incident points', () => {
  it('counts the points picked up on each lap', () => {
    const withIncidents = function* () {
      for (const [t, s] of simpleRace({ lapTime: 100, lapsPerStint: 6, stints: 2, stopSec: 60 }))
        yield [t, { ...s, incidents: s.lapsCompleted >= 9 ? 6 : s.lapsCompleted >= 4 ? 2 : 0 }] as [number, Sample];
    };
    const { d, events } = run(withIncidents());
    const inc = events.flatMap((e) => (e.kind === 'lap' && e.incidents ? [[e.lapsCompleted, e.incidents]] : []));
    expect(inc).toEqual([[4, 2], [9, 4]]);
    expect(d.state().incidents).toBe(6);
  });

  it('leaves incidents out when the sim does not report them', () => {
    const { events } = run(simpleRace({ lapTime: 100, lapsPerStint: 3, stints: 1 }));
    expect(events.some((e) => 'incidents' in e)).toBe(false);
  });
});
