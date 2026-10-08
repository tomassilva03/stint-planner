// The plan for the demo race (src/live/demo.ts, played in the browser or by the helper), so trying the
// demo fills real stints: two drivers, 1:40 laps, 3 L a lap, a stop every 6 laps. The
// demo itself doesn't go to plan, so stints come in ahead and behind and the rest recalc.
import type { Plan } from '../model';
import { newDriver, newPlan } from '../model';
import { DEMO_TRACK } from '../live/apply';

export function demoPlan(now = Date.now()): Plan {
  const base = newPlan('team');
  const a = newDriver(0, 'Driver A');
  const b = newDriver(1, 'Driver B');
  return {
    ...base,
    name: 'Demo race',
    // Starts now and runs 70 minutes, like the demo; once the demo runs, its first lap moves the start to
    // the demo's green flag (alignDemoStart), so the plan lines up whenever it was picked
    event: { ...base.event, sessionStart: new Date(now).toISOString(), greenFlagOffsetMin: 0, durationMin: 70, track: DEMO_TRACK, car: 'Demo GT3' },
    fuel: { ...base.fuel, tankL: 18, perLapL: 3 },
    // The demo spends 20 s on pit road either side of a 60 s stop
    pit: { stopSec: 100, tireSec: 0, tiresByDefault: false },
    baseLapTime: 100,
    // No time-of-day pace changes, so laps stay at the demo's 1:40
    todPeriods: [],
    drivers: [a, b],
    stints: [a, b, a, b, a, b].map((d, i) => ({ id: `demo-${i + 1}`, driverId: d.id, type: 'standard', tires: false, paceModSec: 0 })),
  };
}
