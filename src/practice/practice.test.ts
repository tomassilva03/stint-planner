import { describe, expect, it } from 'vitest';
import { newPlan, type PracticeLap } from '../model';
import type { LiveEvent } from '../live/protocol';
import { applyFuel, applyPace, byDriver, recordLaps, summarize } from './practice';

const lap = (n: number, lapTime: number | null, fuelUsed: number | null, green = true): LiveEvent => ({
  kind: 'lap',
  id: `lap-0-${n}`,
  at: new Date(Date.UTC(2026, 9, 10, 22, 0, n)).toISOString(),
  lapsCompleted: n,
  lapTime,
  fuelUsed,
  green,
});

describe('practice', () => {
  it('records each helper lap once', () => {
    const plan = newPlan('solo');
    const events = [lap(1, 130, 3, false), lap(2, 100, 3)];
    const once = recordLaps(plan, events, null)!;
    expect(once.practice.laps).toHaveLength(2);
    expect(recordLaps(once, events, null)).toBeNull();
    expect(recordLaps(once, [...events, lap(3, 100.2, 3.1)], null)!.practice.laps).toHaveLength(3);
  });

  it('leaves out in/out laps, outliers and excluded laps', () => {
    const times = [100.1, 100.3, 99.9, 100.0, 100.2, 112.5];
    const events = [lap(1, 125, 2.6, false), ...times.map((t, i) => lap(i + 2, t, i === 3 ? 6 : 3 + i * 0.01))];
    const plan = recordLaps(newPlan('solo'), events, null)!;
    const s = summarize(plan.practice.laps);
    expect(s.clean).toBe(5);
    expect(s.avgLap).toBeCloseTo(100.1, 5);
    expect(s.medianLap).toBeCloseTo(100.1, 5);
    expect(s.bestLap).toBe(99.9);
    // The 6 L lap is a fuel outlier; the slow lap's fuel doesn't count either
    expect(s.fuelLaps).toBe(4);
    const laps: PracticeLap[] = plan.practice.laps.map((l) => (l.lapTime === 99.9 ? { ...l, excluded: true } : l));
    expect(summarize(laps).clean).toBe(4);
  });

  it('applies pace and fuel to the plan', () => {
    const team = newPlan('team');
    const d = team.drivers[1];
    expect(applyPace(team, 98.7654, d.id).drivers[1].lapTime).toBe(98.765);
    expect(applyPace(newPlan('solo'), 98.7654).baseLapTime).toBe(98.765);
    expect(applyFuel(team, 3.14159).fuel.perLapL).toBe(3.14);
  });

  it('groups laps by plan driver, matching broken accents', () => {
    const plan = newPlan('team');
    plan.drivers[0].name = 'Tomás Silva';
    const base = { at: '', lap: 1, lapTime: 100, fuelUsed: 3, green: true, track: '', car: '' };
    const g = byDriver([{ ...base, id: 'a', driver: 'Tom�s Silva2' }, { ...base, id: 'b', driver: 'Someone Else' }], plan.drivers);
    expect(g.map((x) => x.name)).toEqual(['Tomás Silva', 'Someone Else']);
    expect(g[0].driver?.id).toBe(plan.drivers[0].id);
  });
});
