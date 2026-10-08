import { describe, expect, it } from 'vitest';
import { demoRace } from './demo';
import { DEMO_CLASS_GT3, DEMO_OUR_IDX, DemoField, demoOutline } from './demoField';
import { FieldTracker, distance, trackDelta, type FieldSnapshot, type RawCar, type RawField } from './field';

const car = (idx: number, laps: number, pct: number, extra: Partial<RawCar> = {}): RawCar => ({
  idx,
  number: String(idx),
  driver: `D${idx}`,
  team: `T${idx}`,
  classId: 1,
  className: 'GT3',
  classColor: '#ffffff',
  lapsCompleted: laps,
  lapPct: pct,
  onPitRoad: false,
  lastLap: null,
  bestLap: null,
  position: 0,
  classPosition: 0,
  ...extra,
});

const field = (t: number, cars: RawCar[], ourIdx = 1): RawField => ({ sessionTime: t, sessionNum: 1, sessionType: 'Race', track: 'Test', trackKm: 4, ourIdx, cars });

/** Two cars at steady speed: car 2 is 5 s behind car 1 on a 100 s lap */
function steady(tr: FieldTracker, until: number) {
  for (let t = 0; t <= until; t += 0.5) {
    const d1 = t / 100;
    const d2 = Math.max(0, (t - 5) / 100);
    tr.push(field(t, [car(1, Math.floor(d1), d1 % 1), car(2, Math.floor(d2), d2 % 1)]));
  }
}

describe('field tracker', () => {
  it('orders cars by distance and times the gap between them', () => {
    const tr = new FieldTracker();
    steady(tr, 150);
    const s = tr.snapshot()!;
    expect(s.cars.map((c) => c.idx)).toEqual([1, 2]);
    expect(s.cars[1].gap).toBeCloseTo(5, 1);
    expect(s.cars[1].int).toBeCloseTo(5, 1);
    expect(s.cars[1].rel).toBeCloseTo(-5, 1);
    expect(s.cars[0].spd).toBeCloseTo(0.01, 3);
  });

  it('counts pit stops', () => {
    const tr = new FieldTracker();
    tr.push(field(0, [car(1, 3, 0.98)]));
    tr.push(field(1, [car(1, 3, 0.99, { onPitRoad: true })]));
    tr.push(field(2, [car(1, 4, 0.01)]));
    const c = tr.snapshot()!.cars[0];
    expect(c.pits).toBe(1);
    expect(c.pitLap).toBe(4);
  });

  it('shows lapped cars as laps down', () => {
    const tr = new FieldTracker();
    tr.push(field(0, [car(1, 10, 0.5), car(2, 9, 0.2)]));
    const s = tr.snapshot()!;
    expect(s.cars[1].down).toBe(1);
    expect(s.cars[1].gap).toBeNull();
  });

  it('measures track position across the line', () => {
    expect(trackDelta(0.02, 0.98)).toBeCloseTo(0.04);
    expect(trackDelta(0.98, 0.02)).toBeCloseTo(-0.04);
    expect(distance(0, 0.97)).toBeCloseTo(-0.03);
  });
});

describe('demo field', () => {
  const demo = new DemoField();
  const tr = new FieldTracker();
  let last: FieldSnapshot | null = null;
  const snaps: FieldSnapshot[] = [];
  for (const [t, s] of demoRace(0.5)) {
    tr.push(demo.read(t, s));
    if (t % 60 === 0) snaps.push(tr.snapshot()!);
    last = tr.snapshot();
  }

  it('has 25 cars in three classes with ours among the GT3s', () => {
    expect(last!.cars).toHaveLength(25);
    expect(new Set(last!.cars.map((c) => c.clsName))).toEqual(new Set(['LMP2', 'GT3', 'GT4']));
    const ours = last!.cars.find((c) => c.idx === DEMO_OUR_IDX)!;
    expect(ours.cls).toBe(DEMO_CLASS_GT3);
  });

  it('runs a believable race: our car makes five stops and a drive-through, faster classes lap slower ones', () => {
    const ours = last!.cars.find((c) => c.idx === DEMO_OUR_IDX)!;
    expect(ours.pits).toBe(6);
    expect(last!.cars[0].clsName).toBe('LMP2');
    const gt4 = last!.cars.filter((c) => c.clsName === 'GT4');
    expect(Math.max(...gt4.map((c) => c.laps))).toBeLessThan(last!.cars[0].laps);
    // Mid-race, gaps are known for cars on the lead lap of their class and are positive
    const mid = snaps[30];
    for (const c of mid.cars) if (c.gap != null) expect(c.gap).toBeGreaterThanOrEqual(0);
    expect(mid.cars.filter((c) => c.gap != null).length).toBeGreaterThan(10);
    // Relatives near our car
    expect(mid.cars.filter((c) => c.rel != null && Math.abs(c.rel) < 30).length).toBeGreaterThan(2);
  });

  it('has an outline of evenly spaced points', () => {
    const o = demoOutline(240);
    expect(o).toHaveLength(480);
    for (const v of o) expect(v).toBeGreaterThanOrEqual(0);
  });
});
