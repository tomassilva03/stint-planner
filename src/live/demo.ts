// A made-up race for trying the live link without iRacing: steady laps, fuel
// burning down, pit stops with driver swaps, one drive-through and one caution.
import { FLAG_CAUTION, type Sample } from './protocol';

export interface DemoOptions {
  lapTime?: number;
  lapsPerStint?: number;
  stints?: number;
  stopSec?: number;
  fuelPerLap?: number;
  drivers?: string[];
  /** Seconds between samples */
  step?: number;
}

/** Yields [seconds since green flag, sample] pairs. */
export function* demoRace(o: DemoOptions = {}): Generator<[number, Sample]> {
  const lapTime = o.lapTime ?? 100;
  const lapsPerStint = o.lapsPerStint ?? 6;
  const stints = o.stints ?? 4;
  const stopSec = o.stopSec ?? 60;
  const fuelPerLap = o.fuelPerLap ?? 3;
  const drivers = o.drivers ?? ['Driver A', 'Driver B'];
  const step = o.step ?? 0.5;
  const tank = fuelPerLap * (lapsPerStint + 1);
  const pitLane = 20; // seconds on pit road either side of the stop
  const total = stints * lapsPerStint * lapTime + (stints - 1) * (stopSec + 2 * pitLane) + 2;

  let laps = 0;
  let lastLap = -1;
  let fuel = tank;
  let lapStart = 0;
  let stint = 0;
  let pitUntil = -1;
  let pitFrom = -1;
  let driveThroughAt = -1;
  const cautionFrom = (lapsPerStint + 2) * lapTime;
  const cautionTo = cautionFrom + 2 * lapTime;

  for (let t = 0; t <= total; t += step) {
    let onPitRoad = false;
    let inPitStall = false;
    if (pitFrom >= 0 && t < pitUntil) {
      onPitRoad = true;
      inPitStall = t >= pitFrom + pitLane && t < pitUntil - pitLane;
      if (inPitStall) fuel = Math.min(tank, fuel + (tank / stopSec) * step * 2);
    } else if (pitFrom >= 0) {
      pitFrom = -1;
      stint++;
      lapStart = t;
    } else if (driveThroughAt >= 0 && t >= driveThroughAt && t < driveThroughAt + 30) {
      onPitRoad = true;
    } else {
      fuel -= (fuelPerLap / lapTime) * step;
      if (t - lapStart >= lapTime) {
        lastLap = lapTime + ((laps * 37) % 7) / 10 + (t >= cautionFrom && t < cautionTo ? 40 : 0);
        laps++;
        lapStart = t;
        if (laps % lapsPerStint === 0 && stint < stints - 1) {
          pitFrom = t;
          pitUntil = t + stopSec + 2 * pitLane;
        }
        if (laps === lapsPerStint * 2 + 2) driveThroughAt = t + lapTime / 2;
      }
    }
    const driverName = drivers[(stint + (pitFrom >= 0 && t >= pitFrom + pitLane + stopSec / 2 ? 1 : 0)) % drivers.length];
    yield [
      t,
      {
        sessionTime: 600 + t,
        sessionNum: 2,
        sessionType: 'Race',
        sessionTimeRemain: Math.max(0, total - t),
        lapsCompleted: laps,
        lastLapTime: lastLap,
        onPitRoad,
        inPitStall,
        fuelLevel: Math.max(0, Math.round(fuel * 100) / 100),
        flags: t >= cautionFrom && t < cautionTo ? FLAG_CAUTION : 0,
        driverName,
        track: 'Demo Raceway',
        car: 'Demo GT3',
      },
    ];
  }
}
