// Practice laps from the iRacing helper: recording them into the plan and
// boiling them down to a pace and fuel figure the plan can use. Pure.
import type { Driver, Plan, PracticeLap } from '../model';
import { matchDriver } from '../live/names';
import type { LiveEvent, LiveState } from '../live/protocol';
import { median, robustSpread } from '../strategy/stats';

/** Laps further than this many robust spreads from the median are outliers (spins, traffic, a flying start) */
const K = 3;
/** Never call a lap an outlier for being this close to the median: 0.5% of a lap, or 0.05 L of fuel */
const LAP_FLOOR = 0.005;
const FUEL_FLOOR_L = 0.05;

/** Adds the helper's lap events not yet in the plan. Returns null when there is nothing new. */
export function recordLaps(plan: Plan, events: LiveEvent[], state: LiveState | null): Plan | null {
  const have = new Set(plan.practice.laps.map((l) => l.id));
  const add: PracticeLap[] = [];
  for (const ev of events) {
    if (ev.kind !== 'lap') continue;
    const id = `${ev.id}@${ev.at}`;
    if (have.has(id)) continue;
    have.add(id);
    add.push({
      id,
      at: ev.at,
      lap: ev.lapsCompleted,
      lapTime: ev.lapTime,
      fuelUsed: ev.fuelUsed,
      green: ev.green,
      incidents: ev.incidents ?? null,
      driver: state?.driverName ?? '',
      track: state?.track ?? '',
      car: state?.car ?? '',
    });
  }
  if (!add.length) return null;
  return { ...plan, practice: { ...plan.practice, laps: [...plan.practice.laps, ...add] } };
}

export type LapStatus = 'clean' | 'inout' | 'outlier' | 'excluded' | 'notime';

export interface PracticeSummary {
  laps: number;
  /** Incident points over the laps that reported them; null when none did (older helper) */
  incidents: number | null;
  /** Laps that reported incident points */
  incidentLaps: number;
  clean: number;
  avgLap: number | null;
  medianLap: number | null;
  bestLap: number | null;
  /** Fuel from clean laps only */
  avgFuel: number | null;
  medianFuel: number | null;
  fuelLaps: number;
  status: Map<string, LapStatus>;
  fuelOutliers: Set<string>;
}

/** Ids of the values that sit too far from the median */
function outliers(items: { id: string; v: number }[], floor: number): Set<string> {
  const out = new Set<string>();
  // Too few laps to tell an odd one from a normal one
  if (items.length < 4) return out;
  const vs = items.map((x) => x.v);
  const m = median(vs)!;
  const limit = Math.max(K * robustSpread(vs)!, floor);
  for (const x of items) if (Math.abs(x.v - m) > limit) out.add(x.id);
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(laps: PracticeLap[]): PracticeSummary {
  const status = new Map<string, LapStatus>();
  const timed: { id: string; v: number }[] = [];
  for (const l of laps) {
    if (l.excluded) status.set(l.id, 'excluded');
    else if (!l.green) status.set(l.id, 'inout');
    else if (!(l.lapTime && l.lapTime > 0)) status.set(l.id, 'notime');
    else timed.push({ id: l.id, v: l.lapTime });
  }
  const med = median(timed.map((x) => x.v));
  const slow = outliers(timed, (med ?? 0) * LAP_FLOOR);
  for (const x of timed) status.set(x.id, slow.has(x.id) ? 'outlier' : 'clean');
  const clean = timed.filter((x) => !slow.has(x.id)).map((x) => x.v);

  const fuelItems = laps.filter((l) => status.get(l.id) === 'clean' && l.fuelUsed && l.fuelUsed > 0).map((l) => ({ id: l.id, v: l.fuelUsed! }));
  const fuelOutliers = outliers(fuelItems, FUEL_FLOOR_L);
  const fuel = fuelItems.filter((x) => !fuelOutliers.has(x.id)).map((x) => x.v);

  const counted = laps.filter((l) => l.incidents != null);
  return {
    laps: laps.length,
    incidents: counted.length ? counted.reduce((a, l) => a + l.incidents!, 0) : null,
    incidentLaps: counted.length,
    clean: clean.length,
    avgLap: mean(clean),
    medianLap: median(clean),
    bestLap: clean.length ? Math.min(...clean) : null,
    avgFuel: mean(fuel),
    medianFuel: median(fuel),
    fuelLaps: fuel.length,
    status,
    fuelOutliers,
  };
}

export interface DriverGroup {
  key: string;
  name: string;
  driver?: Driver;
  laps: PracticeLap[];
}

/** Laps per driver, matched to the plan's drivers where the name fits */
export function byDriver(laps: PracticeLap[], drivers: Driver[]): DriverGroup[] {
  const groups = new Map<string, DriverGroup>();
  for (const l of laps) {
    const d = matchDriver(l.driver, drivers);
    const key = d?.id ?? `raw:${l.driver}`;
    const g = groups.get(key) ?? { key, name: d?.name ?? (l.driver.replace(/�/g, '?') || 'Unknown driver'), driver: d, laps: [] };
    g.laps.push(l);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Rounded the way the plan's fields show them */
export const roundLap = (sec: number) => Math.round(sec * 1000) / 1000;
export const roundFuel = (l: number) => Math.round(l * 100) / 100;

/** Puts a lap time on the plan: a team driver's own pace, or the solo pace */
export function applyPace(plan: Plan, lapTime: number, driverId?: string): Plan {
  const t = roundLap(lapTime);
  if (plan.mode === 'team' && driverId) return { ...plan, drivers: plan.drivers.map((d) => (d.id === driverId ? { ...d, lapTime: t } : d)) };
  return { ...plan, baseLapTime: t };
}

export function applyFuel(plan: Plan, perLap: number): Plan {
  return { ...plan, fuel: { ...plan.fuel, perLapL: roundFuel(perLap) } };
}
