import { describe, expect, it } from 'vitest';
import { compute } from '../engine';
import { demoRace } from '../live/demo';
import type { LiveEvent, LiveState, Sample } from '../live/protocol';
import { newDriver, newPlan, type Plan } from '../model';
import { demoPlan } from '../samples/demo';
import { decide, MIN_GAIN_SEC, type Recommendation } from './decision';
import { estimateRace } from './estimator';
import { replay } from './replay';

const T0 = Date.parse('2026-10-08T20:00:00Z');

/** One driver, 100 s laps, 3 L a lap, 18 L tank (6-lap stints), 100 s stops */
function evenPlan(minutes: number, fuel: Partial<Plan['fuel']> = {}): Plan {
  const base = newPlan('team');
  const a = newDriver(0, 'Driver A');
  a.lapTime = 100;
  return {
    ...base,
    event: { ...base.event, sessionStart: new Date(T0).toISOString(), greenFlagOffsetMin: 0, durationMin: minutes },
    fuel: { ...base.fuel, tankL: 18, perLapL: 3, ...fuel },
    pit: { stopSec: 100, tireSec: 0, tiresByDefault: false },
    todPeriods: [],
    drivers: [a],
    stints: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, driverId: a.id, type: 'standard' as const, tires: false, paceModSec: 0 })),
  };
}

/** The first stint, `laps` laps in, burning `perLap` litres a lap */
function situation(plan: Plan, laps: number, perLap: number, extra: Partial<LiveState> = {}): Recommendation | null {
  const calc = compute(plan);
  const events: LiveEvent[] = [];
  for (let n = 1; n <= laps; n++)
    events.push({ kind: 'lap', id: `lap-2-${n}`, at: new Date(T0 + n * 100_000).toISOString(), lapsCompleted: n, lapTime: n === 1 ? 104 : 100 + (n % 2) * 0.2, fuelUsed: perLap + (n % 3) * 0.01, green: n > 1 });
  const state: LiveState = {
    connected: true,
    isRace: true,
    track: '',
    car: '',
    driverName: 'Driver A',
    lapsCompleted: laps,
    lastLapTime: 100,
    avgLapTime: 100,
    fuelLevel: plan.fuel.tankL - laps * perLap,
    fuelPerLap: perLap,
    onPitRoad: false,
    caution: false,
    sessionTimeRemain: plan.event.durationMin * 60 - laps * 100,
    ...extra,
  };
  return decide(plan, calc, estimateRace(plan, calc, events, state)!);
}

describe('decision engine', () => {
  it('stays on the plan when nothing gains enough', () => {
    const d = situation(evenPlan(60), 3, 2.9)!;
    expect(d.severity).toBe('stable');
    expect(d.best).toBe(d.stay);
    expect(d.best.stopLap).toBe(6);
    expect(d.reasons.join(' ')).toMatch(/plan stands/);
  });

  it('stays out longer when that saves a stop before the flag', () => {
    // 2.5 L a lap: a tank lasts 7 laps, and in 65 minutes stopping a lap later saves a whole stop
    const d = situation(evenPlan(65), 3, 2.5)!;
    expect(d.severity).toBe('change');
    expect(d.best.action).toBe('extend');
    expect(d.best.stopLap).toBe(7);
    expect(d.best.stops).toBe(d.stay.stops - 1);
    expect(d.best.gainSec).toBeGreaterThan(80);
    expect(d.best.risky).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/1 fewer stop/);
  });

  it('never recommends staying out past the fuel', () => {
    const d = situation(evenPlan(65), 3, 2.5)!;
    for (const o of d.options.filter((o) => o.fuelMarginLaps < 0)) expect(o.risky).toBe(true);
    expect(d.options.find((o) => o.label === 'Stay out 2 more laps')!.risky).toBe(true);
  });

  it('pits early when the fuel won’t reach the planned stop', () => {
    const d = situation(evenPlan(60), 3, 3.3)!;
    expect(d.severity).toBe('critical');
    expect(d.stay.risky).toBe(true);
    expect(d.best.stopLap).toBeLessThanOrEqual(5);
    expect(d.best.risky).toBe(false);
    expect(d.reasons[0]).toMatch(/runs out on lap 5, before the planned stop on lap 6/);
  });

  it('saves fuel when that removes a stop', () => {
    // 3.1 L a lap in an 18.5 L tank: 5-lap stints, but saving 5% makes them 6 laps
    const d = situation(evenPlan(60, { tankL: 18.5, saveFuelFactor: 0.95 }), 3, 3.1)!;
    expect(d.best.action).toBe('save');
    expect(d.best.stops).toBeLessThan(d.baseline.stops);
    expect(d.best.gainSec).toBeGreaterThan(50);
    expect(d.reasons.join(' ')).toMatch(/Saving fuel needs 1 fewer stop/);
  });

  it('pits under caution when the stop is cheaper and costs no extra stop', () => {
    const d = situation(evenPlan(60), 4, 2.9, { caution: true })!;
    expect(d.severity).toBe('change');
    expect(d.best.lapsToStop).toBe(1);
    expect(d.best.stops).toBe(d.stay.stops);
    expect(d.best.gainSec).toBeCloseTo(70, 0);
    expect(d.reasons.join(' ')).toMatch(/under caution costs about 30 s instead of 100 s/);
  });

  it('has nothing to decide in the pits', () => {
    expect(situation(evenPlan(60), 3, 2.9, { onPitRoad: true })).toBeNull();
  });
});

describe('demo race replayed', () => {
  function* timed(): Generator<[number, Sample]> {
    for (const [t, s] of demoRace()) yield [T0 + t * 1000, s];
  }
  const calls = new Map<number, Recommendation | null>();
  for (const st of replay(timed(), demoPlan(T0))) if (st.race) calls.set(st.race.lapsCompleted, decide(st.plan, compute(st.plan), st.race));

  it('keeps to the plan while the race goes to plan', () => {
    for (const lap of [1, 2, 3, 4, 5, 7, 8, 9]) expect(calls.get(lap)!.severity).toBe('stable');
  });

  it('never says the fuel runs out, because it never did', () => {
    for (const d of calls.values()) if (d) expect(d.severity).not.toBe('critical');
  });

  it('calls for a stop under the safety car', () => {
    const d = calls.get(23)!;
    expect(d.best.lapsToStop).toBe(1);
    expect(d.best.gainSec).toBeGreaterThan(MIN_GAIN_SEC);
  });

  it('runs to the flag on the last stint', () => {
    const d = calls.get(33)!;
    expect(d.best.label).toBe('Run to the flag');
    expect(d.best.stops).toBe(0);
  });
});
