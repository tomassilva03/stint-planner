import { describe, expect, it } from 'vitest';
import { compute } from '../engine';
import { samplePlan } from '../sample';
import { applyEvents, applyPitExit } from './apply';
import type { LiveEvent } from './protocol';

const plan = samplePlan();
plan.stints.forEach((s) => ((s.actualEnd = undefined), (s.actualLaps = undefined)));
const calc = compute(plan);
const exit = (min: number, laps: number, extra: Partial<LiveEvent> = {}): LiveEvent =>
  ({ kind: 'pitExit', id: `pitExit-2-${laps}`, at: new Date(calc.raceStart + min * 60_000).toISOString(), lapsCompleted: laps, stopSec: 70, stopped: true, ...extra }) as LiveEvent;

describe('applying pit exits to a plan', () => {
  it('fills the actual end and laps of the first unfinished stint', () => {
    const p = applyPitExit(plan, exit(65, 7))!;
    expect(p.stints[0].actualEnd).toBe(exit(65, 7).at);
    expect(p.stints[0].actualLaps).toBe(7);
    expect(p.stints[0].lapsAtEnd).toBe(7);
    expect(plan.stints[0].actualEnd).toBeUndefined();
  });

  it('counts laps from the previous stop', () => {
    const p = applyEvents(plan, [exit(65, 7), exit(130, 15)]);
    expect(p.stints[1].actualLaps).toBe(8);
  });

  it('never applies the same stop twice, even after a page refresh replays it', () => {
    const once = applyEvents(plan, [exit(65, 7)]);
    expect(applyEvents(once, [exit(65, 7)])).toBe(once);
  });

  it('ignores drive-throughs, other kinds of events and stops outside the race', () => {
    expect(applyPitExit(plan, exit(65, 7, { stopped: false } as Partial<LiveEvent>))).toBeNull();
    expect(applyPitExit(plan, { ...exit(65, 7), kind: 'pitEntry' } as LiveEvent)).toBeNull();
    expect(applyPitExit(plan, exit(-30, 0))).toBeNull();
    expect(applyPitExit(plan, exit(60 * 24 * 3, 500))).toBeNull();
  });

  it('leaves laps empty when an earlier stint has no lap count', () => {
    const p = structuredClone(plan);
    p.stints[0].actualEnd = new Date(calc.raceStart + 65 * 60_000).toISOString();
    const out = applyPitExit(p, exit(130, 15))!;
    expect(out.stints[1].actualEnd).toBeDefined();
    expect(out.stints[1].actualLaps).toBeUndefined();
  });

  it('never ends the final stint at a stop', () => {
    const p = structuredClone(plan);
    const finalIdx = calc.stints.findIndex((s) => s.isFinal);
    p.stints.slice(0, finalIdx).forEach((s, i) => (s.actualEnd = new Date(calc.stints[i].end).toISOString()));
    const lastPlanned = calc.stints[finalIdx].start;
    expect(applyPitExit(p, exit((lastPlanned - calc.raceStart) / 60_000 + 30, 900))).toBeNull();
  });
});
