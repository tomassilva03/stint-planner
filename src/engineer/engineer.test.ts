import { describe, expect, it } from 'vitest';
import { demoRace } from '../live/demo';
import { DEMO_OUR_IDX, DemoField } from '../live/demoField';
import { Detector } from '../live/detector';
import { FieldTracker, type FieldSnapshot } from '../live/field';
import type { LiveEvent } from '../live/protocol';
import { pickFeed, STALE_MS, summarise, type EngineerFeed } from './feed';
import { classes, gapText, neighbours, relatives } from './view';

/** The demo race up to `until` seconds, as the helper would see it */
function demoAt(until: number) {
  const det = new Detector();
  const demo = new DemoField();
  const tr = new FieldTracker();
  const events: LiveEvent[] = [];
  let field: FieldSnapshot | null = null;
  for (const [t, s] of demoRace(0.5)) {
    if (t > until) break;
    events.push(...det.push(s, t * 1000));
    tr.push(demo.read(t, s));
    field = tr.snapshot();
  }
  return { events, state: det.state(), field: field! };
}

describe('race engineer view', () => {
  const mid = demoAt(40 * 60);

  it('sums up our race from the helper events', () => {
    const t = summarise(mid.events);
    expect(t.stops).toBeGreaterThanOrEqual(3);
    expect(t.lastStopLap).toBeGreaterThan(0);
    expect(t.laps.length).toBe(8);
    expect(t.laps[t.laps.length - 1].lap).toBe(mid.state.lapsCompleted);
  });

  it('lists the cars around us on the road, nearest in the middle', () => {
    const rows = relatives(mid.field, 3);
    expect(rows).toHaveLength(7);
    expect(rows[3].car.idx).toBe(DEMO_OUR_IDX);
    const gaps = rows.map((r) => r.rel!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
  });

  it('finds the cars ahead and behind in class', () => {
    const { ours, ahead, behind } = neighbours(mid.field);
    expect(ours?.idx).toBe(DEMO_OUR_IDX);
    if (ahead) expect(ahead.clsPos).toBe(ours!.clsPos - 1);
    if (behind) expect(behind.clsPos).toBe(ours!.clsPos + 1);
    expect(classes(mid.field).map((c) => c.count)).toEqual([5, 11, 9]);
  });

  it('writes gaps the way a timing screen does', () => {
    const c = mid.field.cars[0];
    expect(gapText(c, true)).toBe('Leader');
    expect(gapText({ ...c, clsPos: 3, down: 2 }, true)).toBe('+2 laps');
    expect(gapText({ ...c, clsPos: 3, down: 0, gap: 72.34 }, true)).toBe('+1:12.3');
  });
});

describe('choosing a feed', () => {
  const feed = (from: string, sentAt: number, fuel: number | null): EngineerFeed => ({
    v: 1,
    from,
    sentAt,
    source: 'iracing',
    state: fuel == null ? null : ({ fuelLevel: fuel } as EngineerFeed['state']),
    field: null,
    team: { stops: 0, lastStopLap: null, lastStopSec: null, laps: [] },
  });

  it('prefers the driving PC, which knows the fuel, and drops quiet ones', () => {
    const now = 100_000;
    expect(pickFeed([feed('a', now - 500, null), feed('b', now - 900, 20)], now)?.from).toBe('b');
    expect(pickFeed([feed('a', now - 500, null), feed('b', now - STALE_MS - 1, 20)], now)?.from).toBe('a');
    expect(pickFeed([], now)).toBeNull();
  });
});
