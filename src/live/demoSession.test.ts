import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEvents } from './apply';
import { playDemo } from './demoSession';
import type { HelperMessage, LiveEvent } from './protocol';
import { demoPlan } from '../samples/demo';

describe('demo race in the browser', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-10-08T20:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('sends what the helper sends, and fills the demo plan like the helper demo does', () => {
    const got: HelperMessage[] = [];
    playDemo(30, (m) => got.push(m));
    expect(got[0]).toMatchObject({ type: 'hello', source: 'demo' });
    // 70 minutes of race at 30x is under 2.5 minutes
    vi.advanceTimersByTime(150_000);
    const events = got.flatMap((m) => (m.type === 'event' ? [m.event] : [])) as LiveEvent[];
    expect(events.filter((e) => e.kind === 'pitExit' && e.stopped)).toHaveLength(5);
    expect(events.filter((e) => e.kind === 'finish')).toHaveLength(1);
    expect(got.filter((m) => m.type === 'outline')).toHaveLength(1);
    expect(got.some((m) => m.type === 'field' && m.field.cars.length > 20)).toBe(true);
    expect(got.some((m) => m.type === 'state' && m.state.connected)).toBe(true);

    const plan = applyEvents(demoPlan(), events);
    expect(plan.stints.map((s) => s.actualLaps ?? null)).toEqual([6, 6, 7, 6, 5, 5]);
  });

  it('keeps up when the browser runs its timers late, and stops when asked', () => {
    const got: HelperMessage[] = [];
    const session = playDemo(10, (m) => got.push(m));
    // A background tab: one late tick after 30 s still plays 5 minutes of race
    vi.setSystemTime(Date.now() + 30_000);
    vi.advanceTimersByTime(100);
    const laps = got.filter((m) => m.type === 'event' && m.event.kind === 'lap').length;
    expect(laps).toBe(3);
    session.stop();
    vi.advanceTimersByTime(600_000);
    expect(got.filter((m) => m.type === 'event' && m.event.kind === 'lap').length).toBe(laps);
  });
});
