// A plan that matches the helper's demo race (src/live/demo.ts), starting now, so trying
// the demo fills real stints: two drivers, 1:40 laps, 3 L a lap, a stop every 6 laps.
import type { Plan } from '../model';
import { newDriver, newPlan } from '../model';

export function demoPlan(now = Date.now()): Plan {
  const base = newPlan('team');
  const a = newDriver(0, 'Driver A');
  const b = newDriver(1, 'Driver B');
  return {
    ...base,
    name: 'Demo race (for the helper’s demo)',
    // Starts a few minutes ago and runs two hours, so a demo started within the hour lands in it
    event: { ...base.event, sessionStart: new Date(now - 5 * 60_000).toISOString(), greenFlagOffsetMin: 0, durationMin: 120, track: 'Demo Raceway', car: 'Demo GT3' },
    fuel: { ...base.fuel, tankL: 18, perLapL: 3 },
    pit: { stopSec: 60, tireSec: 0, tiresByDefault: false },
    baseLapTime: 100,
    drivers: [a, b],
    stints: [a, b, a, b, a, b].map((d, i) => ({ id: `demo-${i + 1}`, driverId: d.id, type: 'standard', tires: false, paceModSec: 0 })),
  };
}
