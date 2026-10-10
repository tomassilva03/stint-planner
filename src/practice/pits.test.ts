import { describe, expect, it } from 'vitest';
import type { LiveState } from '../live/protocol';
import type { PracticeLap, PracticeStop } from '../model';
import { PitWatcher, summarizeStops } from './pits';
import { newPlan, setPitTimes } from '../model';

const st = (onPitRoad: boolean, fuelLevel: number | null, lapsCompleted = 10): LiveState => ({
  connected: true, isRace: false, track: 'T', car: 'C', driverName: 'Me', lapsCompleted, lastLapTime: null, avgLapTime: null,
  fuelLevel, fuelPerLap: null, onPitRoad, caution: false, sessionTimeRemain: null,
});

describe('pit stop practice', () => {
  it('times a stop and the fuel taken from half-second readings', () => {
    const w = new PitWatcher();
    let t = 0;
    const push = (s: LiveState) => w.push(s, (t += 500));
    push(st(false, 10));
    push(st(true, 10));
    for (let i = 0; i < 20; i++) push(st(true, 10)); // driving down the lane
    for (let i = 1; i <= 20; i++) push(st(true, 10 + i * 2)); // 40 L in 10 s
    for (let i = 0; i < 10; i++) push(st(true, 50));
    const stop = push(st(false, 50))!;
    expect(stop.lap).toBe(10);
    expect(stop.fuelAdded).toBe(40);
    expect(stop.fillSec).toBeCloseTo(10, 0);
    expect(stop.pitRoadSec).toBe(25.5);
  });

  it('skips a visit it saw only the end of', () => {
    const w = new PitWatcher();
    expect(w.push(st(true, 10), 0)).toBeNull();
    expect(w.push(st(false, 10), 500)).toBeNull();
  });

  it('works out lane loss and tyre time from in and out laps', () => {
    const base = Date.UTC(2026, 9, 10, 22);
    const laps: PracticeLap[] = Array.from({ length: 30 }, (_, i) => ({
      id: `l${i}`, at: new Date(base + i * 100_000).toISOString(), lap: i + 1, lapTime: 100, fuelUsed: 3, green: true, driver: 'Me', track: '', car: '',
    }));
    // Stop 1 on laps 6-7, no tyres: 20 s fuel + 25 s lane loss. Stop 2 on laps 16-17 with tyres: 20 s fuel + 25 s lane + 5 s tyres
    Object.assign(laps[5], { lapTime: 125, green: false });
    Object.assign(laps[6], { lapTime: 120, green: false });
    Object.assign(laps[15], { lapTime: 130, green: false });
    Object.assign(laps[16], { lapTime: 120, green: false });
    const stop = (lap: number, tires: boolean): PracticeStop => ({
      id: `s${lap}`, at: new Date(base + lap * 100_000).toISOString(), lap, pitRoadSec: 50, fuelAdded: 40, fillSec: 20, tires, driver: 'Me',
    });
    const s = summarizeStops([stop(5, false), stop(15, true)], laps);
    expect(s.fillRate).toBe(2);
    expect(s.laneLossSec).toBe(25);
    expect(s.tireSec).toBe(5);
    const plan = newPlan('solo');
    plan.fuel.tankL = 100;
    // Refuel rate alone keeps the stop time as typed; with the lane loss it's worked out
    expect(setPitTimes(plan, { fillRate: 2 }).pit.stopSec).toBe(plan.pit.stopSec);
    expect(setPitTimes(setPitTimes(plan, { fillRate: 2 }), { laneLossSec: 25 }).pit.stopSec).toBe(75);
  });
});
