import { describe, expect, it } from 'vitest';
import { compute } from '../engine';
import { demoRace, simpleRace } from '../live/demo';
import raw from '../live/fixtures/silverstone-race.jsonl?raw';
import type { LiveEvent, LiveState, Sample } from '../live/protocol';
import { newDriver, newPlan, type Plan } from '../model';
import { demoPlan } from '../samples/demo';
import { applyEvent } from '../live/apply';
import { Detector } from '../live/detector';
import { estimateRace, raceLaps, trackLineFuel, type LineFuel } from './estimator';
import { replay, type ReplayStep } from './replay';
import { median, normalCdf, robustMean, theilSen } from './stats';

const T0 = Date.parse('2026-10-08T20:00:00Z');

function* timed(race: Iterable<[number, Sample]>, start = T0): Generator<[number, Sample]> {
  for (const [t, s] of race) yield [start + t * 1000, s];
}

/** The last step at each lap */
const byLap = (steps: Iterable<ReplayStep>) => {
  const m = new Map<number, ReplayStep>();
  for (const st of steps) if (st.race) m.set(st.race.lapsCompleted, st);
  return m;
};

describe('robust statistics', () => {
  it('ignores one odd value', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(robustMean([100, 100.2, 99.8, 100.1, 135], 3, 0.3)).toBeCloseTo(100.025, 3);
    expect(theilSen([[1, 100], [2, 100.1], [3, 100.2], [4, 140], [5, 100.4]])).toBeCloseTo(0.1, 5);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

/** A plan with one driver at 100 s laps, 3 L a lap and an 18 L tank: stops every 6 laps */
function evenPlan(): Plan {
  const base = newPlan('team');
  const a = newDriver(0, 'Driver A');
  a.lapTime = 100;
  return {
    ...base,
    event: { ...base.event, sessionStart: new Date(T0).toISOString(), greenFlagOffsetMin: 0, durationMin: 60 },
    fuel: { ...base.fuel, tankL: 18, perLapL: 3 },
    pit: { stopSec: 100, tireSec: 0, tiresByDefault: false },
    todPeriods: [],
    drivers: [a],
    stints: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, driverId: a.id, type: 'standard' as const, tires: false, paceModSec: 0 })),
  };
}

const lap = (n: number, lapTime: number | null, fuelUsed: number | null, green = true): LiveEvent => ({
  kind: 'lap',
  id: `lap-2-${n}`,
  at: new Date(T0 + n * 100_000).toISOString(),
  lapsCompleted: n,
  lapTime,
  fuelUsed,
  green,
});

const state = (laps: number, fuelLevel: number | null): LiveState => ({
  connected: true,
  isRace: true,
  track: '',
  car: '',
  driverName: 'Driver A',
  lapsCompleted: laps,
  lastLapTime: null,
  avgLapTime: null,
  fuelLevel,
  fuelPerLap: null,
  onPitRoad: false,
  caution: false,
  sessionTimeRemain: 3600 - laps * 100,
});

describe('estimator', () => {
  const plan = evenPlan();
  const calc = compute(plan);

  it('uses the plan until there are laps, with low confidence', () => {
    const r = estimateRace(plan, calc, [], state(0, 18))!;
    expect(r.pace.source).toBe('plan');
    expect(r.pace.lapTime).toBe(100);
    expect(r.fuel.perLap).toBe(3);
    expect(r.fuel.plannedPitLap).toBe(6);
    expect(r.fuel.lapsLeft).toBe(6);
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('shrugs off one bad lap and sees fuel use below the plan', () => {
    // Lap 1 isn't green (the start); lap 4 has a spin but stays green
    const events = [lap(1, 104, 2.9, false), lap(2, 100.2, 2.85), lap(3, 100.0, 2.86), lap(4, 112.5, 2.84), lap(5, 100.1, 2.85)];
    const r = estimateRace(plan, calc, events, state(5, 18 - 5 * 2.85))!;
    expect(r.pace.source).toBe('stint');
    expect(r.pace.lapTime).toBeCloseTo(100.1, 1);
    expect(r.pace.median3).toBe(100.1);
    expect(r.fuel.perLap).toBeCloseTo(2.85, 2);
    expect(r.fuel.deltaPct).toBeCloseTo(-0.05, 2);
    // 3.75 L left at 2.85 L a lap: dry during lap 7, a lap after the planned stop on lap 6
    expect(r.fuel.lapsLeft).toBeCloseTo(1.316, 2);
    expect(r.fuel.emptyLap).toBe(6);
    expect(r.fuel.marginLaps).toBeCloseTo(0.316, 2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('works out the fuel left when the tank level is unknown (a teammate’s PC)', () => {
    const events = [lap(1, 104, null, false), lap(2, 100.2, null), lap(3, 100.0, null)];
    const r = estimateRace(plan, calc, events, state(3, null))!;
    expect(r.fuel.measured).toBe(false);
    expect(r.fuel.source).toBe('plan');
    expect(r.fuel.level).toBe(9);
    expect(r.caveats.join(' ')).toMatch(/driving PC/);
  });

  it('starts again when the lap count goes back (a new session)', () => {
    const practice = [lap(1, 99, 3), lap(2, 99, 3), lap(3, 99, 3)].map((e) => ({ ...e, id: e.id.replace('-2-', '-1-') }));
    expect(raceLaps([...practice, lap(1, 104, 3, false), lap(2, 100, 3)]).map((e) => e.lapsCompleted)).toEqual([1, 2]);
  });
});

describe('demo race replayed', () => {
  const steps = byLap(replay(timed(demoRace()), demoPlan(T0)));
  const at = (n: number) => steps.get(n)!.race!;

  it('follows each driver’s pace', () => {
    // Driver A runs about 99.5 s, then Driver B about 101.8 s
    expect(at(5).pace.lapTime).toBeGreaterThan(99);
    expect(at(5).pace.lapTime).toBeLessThan(100);
    expect(at(11).stint.index).toBe(2);
    expect(at(11).pace.lapTime).toBeGreaterThan(101.2);
    expect(at(11).pace.deltaVsPlan).toBeGreaterThan(1);
  });

  it('sees the fuel-saving stint last a lap longer than planned', () => {
    const r = at(17);
    expect(r.stint.index).toBe(3);
    expect(r.fuel.perLap).toBeCloseTo(2.6, 1);
    expect(r.fuel.deltaPct).toBeLessThan(-0.1);
    expect(r.fuel.plannedPitLap).toBe(18);
    expect(r.fuel.emptyLap).toBe(19);
    expect(r.fuel.marginLaps).toBeGreaterThan(0.8);
  });

  it('counts the laps to the flag on the last stint', () => {
    const r = at(32);
    expect(r.isFinalStint).toBe(true);
    expect(r.fuel.plannedPitLap).toBeNull();
    expect(r.fuel.lapsToFlag).toBe(3);
    expect(r.fuel.marginLaps).toBeGreaterThan(1);
  });

  it('is unsure at the start and sure mid-stint', () => {
    expect(at(1).confidence).toBeLessThan(0.3);
    expect(at(5).confidence).toBeGreaterThan(0.6);
  });

  it('gives the same answer every time', () => {
    const again = byLap(replay(timed(demoRace()), demoPlan(T0)));
    const numbers = (n: number, m: typeof steps) => {
      const r = m.get(n)!.race!;
      return { pace: r.pace, fuel: r.fuel, confidence: r.confidence };
    };
    for (const n of [3, 13, 20, 30]) expect(numbers(n, again)).toEqual(numbers(n, steps));
  });
});

describe('even race replayed', () => {
  it('lands on the plan’s numbers', () => {
    const plan = evenPlan();
    plan.event.durationMin = 30;
    const steps = byLap(replay(timed(simpleRace({ stints: 3 })), plan));
    const r = steps.get(4)!.race!;
    expect(r.pace.lapTime).toBeCloseTo(100, 1);
    expect(r.fuel.perLap).toBeCloseTo(3, 1);
    expect(r.fuel.plannedPitLap).toBe(6);
  });
});

describe('recorded Silverstone race', () => {
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { at: number; s: Sample });
  // About what was run: 66 s laps, 1.6 L a lap, 100 L tank, one early stop
  const plan = evenPlan();
  plan.event.sessionStart = new Date(rows[0].at).toISOString();
  plan.event.durationMin = 120;
  plan.drivers[0].lapTime = 66;
  plan.fuel = { ...plan.fuel, tankL: 100, perLapL: 1.6 };
  plan.stints = plan.stints.slice(0, 2);
  const steps = byLap(replay(rows.map((r) => [r.at, r.s] as [number, Sample]), plan));

  it('measures the real pace and fuel use', () => {
    const r = steps.get(7)!.race!;
    expect(r.stint.index).toBe(2);
    expect(r.pace.source).toBe('stint');
    expect(r.pace.lapTime).toBeGreaterThan(65);
    expect(r.pace.lapTime).toBeLessThan(66.5);
    expect(r.fuel.measured).toBe(true);
    expect(r.fuel.perLap).toBeCloseTo(1.6, 1);
    // 91.6 L left at 1.6 L a lap
    expect(r.fuel.emptyLap).toBeGreaterThan(60);
    expect(r.confidence).toBeGreaterThan(0.4);
  });
});

describe('fuel counted from the line', () => {
  it('keeps the empty lap steady all through a lap', () => {
    const d = new Detector();
    const events: LiveEvent[] = [];
    let plan = demoPlan(T0);
    let line: LineFuel | null = null;
    const empty = new Map<number, Set<number>>();
    for (const [at, s] of timed(demoRace())) {
      const out = d.push(s, at);
      events.push(...out);
      for (const ev of out) plan = applyEvent(plan, ev) ?? plan;
      const st = d.state();
      line = trackLineFuel(line, st);
      if (st.lapsCompleted < 15 || st.lapsCompleted > 17 || st.onPitRoad) continue;
      const r = estimateRace(plan, compute(plan), events, st, line)!;
      empty.set(st.lapsCompleted, (empty.get(st.lapsCompleted) ?? new Set()).add(r.fuel.emptyLap));
    }
    // One answer per lap (the fuel-per-lap estimate still settles between laps)
    expect([...empty.values()].map((v) => [...v])).toEqual([[18], [19], [19]]);
  });
});
