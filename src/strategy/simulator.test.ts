import { describe, expect, it } from 'vitest';
import { compute, normalize } from '../engine';
import { newDriver, newPlan, type Plan } from '../model';
import { demoPlan } from '../samples/demo';
import { nurburgringPlan } from '../samples/nurburgring';
import { simulateStrategies } from './simulator';

const T0 = Date.parse('2026-10-08T20:00:00Z');
const sim = (p: Plan) => simulateStrategies(p, compute(p))!;
const byId = (s: ReturnType<typeof sim>, id: string) => s.results.find((r) => r.preset.id === id)!;

function evenPlan(minutes: number, fuel: Partial<Plan['fuel']> = {}): Plan {
  const base = newPlan('team');
  const a = newDriver(0, 'Driver A');
  a.lapTime = 100;
  return normalize({
    ...base,
    event: { ...base.event, sessionStart: new Date(T0).toISOString(), greenFlagOffsetMin: 0, durationMin: minutes },
    fuel: { ...base.fuel, tankL: 18.5, perLapL: 3, ...fuel },
    pit: { stopSec: 100, tireSec: 0, tiresByDefault: false },
    todPeriods: [],
    drivers: [a],
    stints: [{ id: 's0', driverId: a.id, type: 'standard', tires: false, paceModSec: 0 }],
  });
}

describe('strategy simulator', () => {
  it('flags a plan that runs every tank to the last drop', () => {
    // The demo plan: an 18 L tank at exactly 3 L a lap
    const s = sim(demoPlan(T0));
    expect(byId(s, 'plan').risk).toBe('High');
    expect(byId(s, 'aggressive').minMarginLaps).toBeCloseTo(0, 5);
    expect(s.recommended.preset.id).toBe('balanced');
    expect(byId(s, 'balanced').minMarginLaps).toBeCloseTo(1, 5);
    // Holding fuel back costs stops
    expect(byId(s, 'conservative').stops).toBeGreaterThan(byId(s, 'balanced').stops);
    expect(byId(s, 'conservative').gapSec).toBeLessThan(0);
  });

  it('saves fuel when that cuts a stop', () => {
    // 3.1 L a lap in 18.5 L: 5-lap stints; saving 5% for 1% pace makes them 6 laps
    const s = sim(evenPlan(60, { perLapL: 3.1, saveFuelFactor: 0.95, saveLapFactor: 1.01 }));
    const aggressive = byId(s, 'aggressive');
    expect(aggressive.saving).toBe(true);
    expect(aggressive.stops).toBeLessThan(byId(s, 'plan').stops);
    expect(aggressive.distance).toBeGreaterThan(byId(s, 'plan').distance);
  });

  it('does not save fuel when it only costs time', () => {
    const s = sim(evenPlan(60));
    expect(byId(s, 'aggressive').saving).toBe(false);
    expect(s.recommended.risk).not.toBe('High');
  });

  it('plays the race as before the start, whatever has been logged', () => {
    const plan = nurburgringPlan();
    const clean = { ...plan, stints: plan.stints.map(({ actualEnd: _e, actualLaps: _l, ...st }) => st) };
    const a = sim(plan);
    const b = sim(clean);
    expect(a.results.map((r) => [r.laps, r.stops])).toEqual(b.results.map((r) => [r.laps, r.stops]));
    expect(a.recommended.preset.id).toBe(b.recommended.preset.id);
  });

  it('measures every gap against the recommended strategy', () => {
    const s = sim(nurburgringPlan());
    expect(s.recommended.gapSec).toBe(0);
    for (const r of s.results) if (r.risk !== 'High' && r.preset.id !== 'plan') expect(r.gapSec).toBeLessThanOrEqual(1);
  });
});
