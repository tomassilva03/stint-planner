// Stint maths. Mirrors the Sassy Enduro Manager sheet:
//   laps per stint  = floor(tank / fuel per lap)
//   stint duration  = laps x lap time x (time-of-day factor x driver factor) + pit stop (+ tyres)
//   final stint     = clipped at race end, laps = ceil(time left / lap time)
//   next stint      = starts when this one actually ended (live) or was planned to end
import type { Avail, Driver, Plan, Stint, StintType, TodPeriod } from './model';
import { uid } from './model';

export type AvailStatus = Avail | 'unknown';

export interface StintCalc {
  index: number;
  stint: Stint;
  driver?: Driver;
  start: number;
  /** When the car pits (or takes the flag on the final stint) */
  pitIn: number;
  plannedEnd: number;
  /** Actual end if logged, otherwise planned end. Next stint starts here. */
  end: number;
  laps: number;
  lapTime: number;
  pitSec: number;
  fuelUsed: number;
  /** Litres to put in at the stop before this stint (full tank except for the final splash) */
  fuelToAdd: number;
  todLabel: string;
  todFactor: number;
  driverFactor: number;
  isFinal: boolean;
  isSurplus: boolean;
  avail: AvailStatus;
  consecutive: number;
  overPref: boolean;
  deltaSec: number | null;
  simStartMin: number;
  /** Laps behind the safety car in this stint */
  scLaps: number;
  /** Unscheduled time lost in this stint (repairs, long stop, penalty), seconds */
  lostSec: number;
  /** League: which tyre set this stint runs on (1 = the set you start on) */
  tyreSet: number;
  /** League: this stint needs a set beyond the limit */
  tyreOver: boolean;
  /** When the car stopped being driven: planned pit-in, or the logged end minus the stop */
  drivenTo: number;
  /** Time this driver has been in the car without a swap, including earlier stints */
  seatRunMs: number;
  /** League: seatRunMs is over the maximum time in the car */
  overSeatTime: boolean;
}

export interface DriverSummary {
  driver: Driver;
  stints: number;
  laps: number;
  driveMs: number;
  meetsFairShare: boolean;
  conflicts: number;
  /** League: under the minimum or over the maximum driving time */
  timeIssue: 'under' | 'over' | null;
}

export interface RaceCalc {
  sessionStart: number;
  raceStart: number;
  raceEnd: number;
  baseLapTime: number;
  lapsPerStint: Record<StintType, number>;
  stintTime: Record<StintType, number>;
  stints: StintCalc[];
  active: StintCalc[];
  totalLaps: number;
  pitStops: number;
  tyreChanges: number;
  driftSec: number;
  fairShareLaps: number;
  fairShareStints: number;
  drivers: DriverSummary[];
  saveStop: SaveStop | null;
  valid: boolean;
  problems: string[];
  league: LeagueCalc | null;
}

export interface LeagueCalc {
  scLaps: number;
  tyreSetsUsed: number;
  tyreSetLimit: number | null;
  minStops: number | null;
  stopsShort: boolean;
}

export interface SaveStop {
  stintsNow: number;
  targetStints: number;
  targetLapsPerStint: number;
  targetFuelPerLap: number;
  savingPct: number;
  lapDelta: number;
  timeSavedSec: number;
}

const MIN = 60_000;
const EPS = 1e-9;

export const hmToMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
};

export function todAt(periods: TodPeriod[], simMin: number): TodPeriod | undefined {
  if (!periods.length) return undefined;
  const sorted = [...periods].sort((a, b) => hmToMin(a.start) - hmToMin(b.start));
  let hit = sorted[sorted.length - 1]; // wraps from the previous day
  for (const p of sorted) if (hmToMin(p.start) <= simMin) hit = p;
  return hit;
}

export function baseLapTime(plan: Plan): number {
  if (plan.mode === 'team') {
    const set = plan.drivers.filter((d) => d.lapTime > 0);
    if (set.length) return set.reduce((s, d) => s + d.lapTime, 0) / set.length;
  }
  return plan.baseLapTime;
}

export function lapsPerStint(plan: Plan, type: StintType): number {
  const perLap = plan.fuel.perLapL * (type === 'save' ? plan.fuel.saveFuelFactor : 1);
  if (perLap <= 0) return 0;
  return Math.floor(plan.fuel.tankL / perLap + EPS);
}

export const slotKey = (t: number, slotMin: number) =>
  new Date(Math.floor(t / (slotMin * MIN)) * slotMin * MIN).toISOString();

export function slotsBetween(from: number, to: number, slotMin: number): number[] {
  const out: number[] = [];
  const step = slotMin * MIN;
  for (let t = Math.floor(from / step) * step; t < to; t += step) out.push(t);
  return out;
}

const AVAIL_RANK: Record<AvailStatus, number> = { open: 0, tentative: 2, unknown: 1, blocked: 3 };

export function availFor(plan: Plan, driverId: string | null, from: number, to: number): AvailStatus {
  if (!driverId) return 'unknown';
  const map = plan.availability[driverId] ?? {};
  let worst: AvailStatus | null = null;
  for (const t of slotsBetween(from, to, plan.slotMin)) {
    const s: AvailStatus = map[new Date(t).toISOString()] ?? 'unknown';
    if (worst === null || AVAIL_RANK[s] > AVAIL_RANK[worst]) worst = s;
  }
  return worst ?? 'unknown';
}

export function raceWindow(plan: Plan) {
  const sessionStart = Date.parse(plan.event.sessionStart);
  const raceStart = sessionStart + plan.event.greenFlagOffsetMin * MIN;
  const raceEnd = raceStart + plan.event.durationMin * MIN;
  return { sessionStart, raceStart, raceEnd };
}

/** In-sim time of day (minutes) at real instant t */
export function simMinAt(plan: Plan, t: number): number {
  const { raceStart } = raceWindow(plan);
  const m = hmToMin(plan.event.simStart) + (t - raceStart) / MIN;
  return ((m % 1440) + 1440) % 1440;
}

export function compute(plan: Plan): RaceCalc {
  const { sessionStart, raceStart, raceEnd } = raceWindow(plan);
  const base = baseLapTime(plan);
  const lps = { standard: lapsPerStint(plan, 'standard'), save: lapsPerStint(plan, 'save') };
  const problems: string[] = [];
  if (!(base > 0)) problems.push('Set a lap time.');
  if (!(lps.standard > 0)) problems.push('Set the fuel tank size and fuel per lap.');
  if (!(raceEnd > raceStart)) problems.push('Set the race duration.');
  if (Number.isNaN(sessionStart)) problems.push('Set the session start.');
  const valid = problems.length === 0;
  const drivers = new Map(plan.drivers.map((d) => [d.id, d]));
  const typeLap = (t: StintType) => (t === 'save' ? plan.fuel.saveLapFactor : 1);
  const typeFuel = (t: StintType) => (t === 'save' ? plan.fuel.saveFuelFactor : 1);
  const league = plan.eventKind === 'league';
  // Safety car laps entered on a stint always count (they are what happened, or
  // what you expect); the league switch only controls the planning tools.
  const sc = plan.rules.safetyCar;
  const tyres = league && plan.rules.tyreSets.enabled ? plan.rules.tyreSets : null;
  const seat = league && plan.rules.driverTime.enabled ? plan.rules.driverTime : null;
  const scLapTime = base * sc.lapTimeFactor;

  const stints: StintCalc[] = [];
  let cursor = raceStart;
  let finished = false;
  for (let i = 0; i < plan.stints.length; i++) {
    const s = plan.stints[i];
    const driver = plan.mode === 'solo' ? plan.drivers[0] : s.driverId ? drivers.get(s.driverId) : undefined;
    const start = cursor;
    const simStartMin = simMinAt(plan, start);
    const tod = todAt(plan.todPeriods, simStartMin);
    const todFactor = tod?.factor ?? 1;
    const driverFactor = plan.mode === 'team' && driver && driver.lapTime > 0 && base > 0 ? driver.lapTime / base : 1;
    const lapTime = valid ? base * typeLap(s.type) * todFactor * driverFactor + (s.paceModSec || 0) : 0;
    // Laps behind the safety car burn less fuel, so the same tank covers more laps.
    const greenFuel = plan.fuel.perLapL * typeFuel(s.type);
    let scLaps = Math.max(0, s.scLaps ?? 0);
    const scFuel = scLaps * plan.fuel.perLapL * sc.fuelFactor;
    // Unscheduled time lost in this stint: repairs, a long stop, a penalty
    const lostMs = Math.max(0, s.lostSec ?? 0) * 1000;
    let greenLaps = scLaps ? Math.max(0, Math.floor((plan.fuel.tankL - scFuel) / greenFuel + EPS)) : lps[s.type];
    // A stint is only surplus once an earlier one took the flag. If the previous
    // stint pitted just before time ran out, this one still has to finish the race.
    const isSurplus = finished;
    let laps = greenLaps + scLaps;
    let pitIn = start + lostMs + (greenLaps * lapTime + scLaps * scLapTime) * 1000;
    let pitSec = (s.pitUnderSc ? sc.pitSec : plan.pit.stopSec) + (s.tires ? plan.pit.tireSec : 0);
    let isFinal = false;
    if (!isSurplus && valid && pitIn >= raceEnd) {
      isFinal = true;
      const left = Math.max(0, (raceEnd - start - lostMs) / 1000);
      const scTime = scLaps * scLapTime;
      if (scLaps && scTime >= left) {
        scLaps = Math.max(1, Math.ceil(left / scLapTime - EPS));
        greenLaps = 0;
      } else {
        greenLaps = Math.max(scLaps ? 0 : 1, Math.ceil((left - scTime) / lapTime - EPS));
      }
      laps = greenLaps + scLaps;
      pitIn = start + lostMs + (greenLaps * lapTime + scLaps * scLapTime) * 1000;
      pitSec = 0;
    }
    const plannedEnd = pitIn + pitSec * 1000;
    const actual = s.actualEnd ? Date.parse(s.actualEnd) : NaN;
    const end = Number.isNaN(actual) ? plannedEnd : actual;
    const prev = stints[i - 1];
    const consecutive = prev && prev.stint.driverId && prev.stint.driverId === s.driverId ? prev.consecutive + 1 : 1;
    const effLaps = s.actualLaps ?? laps;
    const effGreen = Math.max(0, effLaps - scLaps);
    // Logged stints: the driver was on track until the actual end minus the stop
    const drivenTo = Number.isNaN(actual) ? pitIn : Math.max(start, actual - pitSec * 1000);
    const seatRunMs = (consecutive > 1 && prev ? prev.seatRunMs + (prev.end - prev.drivenTo) : 0) + (drivenTo - start);
    stints.push({
      index: i + 1,
      stint: s,
      driver,
      start,
      pitIn,
      plannedEnd,
      end,
      laps: effLaps,
      lapTime,
      pitSec,
      fuelUsed: effGreen * greenFuel + scLaps * plan.fuel.perLapL * sc.fuelFactor,
      lostSec: lostMs / 1000,
      fuelToAdd: 0,
      todLabel: tod?.label ?? '',
      todFactor,
      driverFactor,
      isFinal,
      isSurplus,
      avail: plan.mode === 'team' ? availFor(plan, s.driverId, start, isFinal ? end : pitIn) : 'open',
      consecutive,
      overPref: plan.mode === 'team' && !!driver && consecutive > driver.maxConsecutive,
      deltaSec: Number.isNaN(actual) ? null : (actual - plannedEnd) / 1000,
      simStartMin,
      scLaps,
      tyreSet: 1,
      tyreOver: false,
      drivenTo,
      seatRunMs,
      overSeatTime: !!seat && seat.maxStintMinutes > 0 && seatRunMs > seat.maxStintMinutes * MIN,
    });
    if (isFinal) finished = true;
    cursor = end;
  }

  const active = stints.filter((s) => !s.isSurplus);
  // Start full; each stop refills what the previous stint burned, except the
  // last stop, which only adds enough to reach the flag plus one lap of margin.
  active.forEach((s, i) => {
    if (i === 0) s.fuelToAdd = plan.fuel.tankL;
    else if (s.isFinal) {
      const needed = s.fuelUsed + plan.fuel.perLapL * typeFuel(s.stint.type);
      const left = plan.fuel.tankL - active[i - 1].fuelUsed;
      s.fuelToAdd = Math.max(0, Math.min(plan.fuel.tankL - left, needed - left));
    }
    else s.fuelToAdd = Math.min(plan.fuel.tankL, active[i - 1].fuelUsed);
  });

  // Tyre sets: the stop at the end of a stint with tyres ticked fits a new set.
  const tyreLimit = tyres ? tyres.setsAvailable + (tyres.includesStartSet ? 0 : 1) : null;
  active.forEach((s, i) => {
    s.tyreSet = i === 0 ? 1 : active[i - 1].tyreSet + (active[i - 1].stint.tires ? 1 : 0);
    s.tyreOver = tyreLimit != null && s.tyreSet > tyreLimit;
  });

  const totalLaps = active.reduce((n, s) => n + s.laps, 0);
  const named = plan.mode === 'solo' ? plan.drivers.slice(0, 1) : plan.drivers.filter((d) => d.name.trim());
  const fairShareLaps = named.length ? Math.ceil(totalLaps / named.length / 4) : 0;
  const fairShareStints = lps.standard ? Math.ceil(fairShareLaps / lps.standard) : 0;
  const summaries: DriverSummary[] = named.map((driver) => {
    const mine = active.filter((s) => (plan.mode === 'solo' ? true : s.stint.driverId === driver.id));
    const laps = mine.reduce((n, s) => n + s.laps, 0);
    const driveMs = mine.reduce((n, s) => n + (s.drivenTo - s.start), 0);
    const timeIssue =
      seat && seat.minMinutes > 0 && driveMs < seat.minMinutes * MIN
        ? 'under'
        : seat && seat.maxMinutes > 0 && driveMs > seat.maxMinutes * MIN
          ? 'over'
          : null;
    return {
      driver,
      stints: mine.length,
      laps,
      driveMs,
      meetsFairShare: laps >= fairShareLaps,
      conflicts: mine.filter((s) => s.avail === 'blocked' || s.overPref || s.overSeatTime).length,
      timeIssue,
    };
  });

  let saveStop: SaveStop | null = null;
  if (valid && active.length > 1 && lps.standard > 0) {
    const stintsNow = Math.ceil(totalLaps / lps.standard);
    const targetStints = Math.max(1, stintsNow - 1);
    const targetLapsPerStint = Math.ceil(totalLaps / targetStints);
    const targetFuelPerLap = Math.round((plan.fuel.tankL / targetLapsPerStint) * 1000) / 1000;
    saveStop = {
      stintsNow,
      targetStints,
      targetLapsPerStint,
      targetFuelPerLap,
      savingPct: (plan.fuel.perLapL - targetFuelPerLap) / plan.fuel.perLapL,
      lapDelta: targetLapsPerStint - lps.standard,
      timeSavedSec: plan.pit.stopSec,
    };
  }

  return {
    sessionStart,
    raceStart,
    raceEnd,
    baseLapTime: base,
    lapsPerStint: lps,
    stintTime: {
      standard: lps.standard * base,
      save: lps.save * base * plan.fuel.saveLapFactor,
    },
    stints,
    active,
    totalLaps,
    pitStops: Math.max(0, active.length - 1),
    tyreChanges: active.filter((s) => !s.isFinal && s.stint.tires).length,
    driftSec: active.reduce((n, s) => n + (s.deltaSec ?? 0), 0),
    fairShareLaps,
    fairShareStints,
    drivers: summaries,
    saveStop,
    valid,
    problems,
    league: league
      ? {
          scLaps: active.reduce((n, s) => n + s.scLaps, 0),
          tyreSetsUsed: active.length ? active[active.length - 1].tyreSet : 0,
          tyreSetLimit: tyreLimit,
          minStops: plan.rules.minPitStops.enabled ? plan.rules.minPitStops.count : null,
          stopsShort: plan.rules.minPitStops.enabled && Math.max(0, active.length - 1) < plan.rules.minPitStops.count,
        }
      : null,
  };
}

/**
 * Plan the expected safety cars: spread them evenly over the race and add their
 * laps to the stints running at those moments. Replaces any planned (not logged) SC laps.
 */
export function spreadSafetyCars(plan: Plan): Plan {
  const { expectedCount, avgLaps } = plan.rules.safetyCar;
  const calc = compute(plan);
  const stints = plan.stints.map((s) => (s.actualEnd ? s : { ...s, scLaps: 0 }));
  const span = calc.raceEnd - calc.raceStart;
  for (let k = 1; k <= expectedCount; k++) {
    const t = calc.raceStart + (span * k) / (expectedCount + 1);
    const i = calc.active.findIndex((s) => t >= s.start && t < s.end);
    if (i >= 0 && !stints[i].actualEnd) stints[i] = { ...stints[i], scLaps: (stints[i].scLaps ?? 0) + avgLaps };
  }
  return { ...plan, stints };
}

export function blankStint(plan: Plan, prev?: Stint): Stint {
  return {
    id: uid(),
    driverId: plan.mode === 'solo' ? plan.drivers[0]?.id ?? null : null,
    type: prev?.type ?? 'standard',
    tires: plan.pit.tiresByDefault,
    paceModSec: 0,
  };
}

const isBlank = (s: Stint) => !s.driverId && !s.actualEnd && s.actualLaps == null && !s.note;

/** Add stints until the plan reaches the flag, and drop unused ones after it. */
export function normalize(plan: Plan): Plan {
  let stints = plan.stints;
  if (plan.mode === 'solo') {
    const id = plan.drivers[0]?.id ?? null;
    if (stints.some((s) => s.driverId !== id)) stints = stints.map((s) => ({ ...s, driverId: id }));
  }
  let p = { ...plan, stints };
  let calc = compute(p);
  if (!calc.valid) return p;
  let guard = 0;
  while (!calc.stints.some((s) => s.isFinal) && guard++ < 400) {
    p = { ...p, stints: [...p.stints, blankStint(p, p.stints[p.stints.length - 1])] };
    calc = compute(p);
  }
  const trailing = [...p.stints];
  while (trailing.length && calc.stints[trailing.length - 1]?.isSurplus && (isBlank(trailing[trailing.length - 1]) || plan.mode === 'solo') && !trailing[trailing.length - 1].actualEnd) {
    trailing.pop();
  }
  if (trailing.length !== p.stints.length) p = { ...p, stints: trailing };
  return p;
}

const AUTO_PREF: Record<AvailStatus, number> = { open: 0, tentative: 2, unknown: 3, blocked: 50 };

/**
 * Fill unassigned stints. Keeps the current driver while they are open and under
 * their back-to-back limit, otherwise picks the best-available driver with the
 * least seat time so far.
 */
export function autoAssign(plan: Plan): Plan {
  const team = plan.drivers.filter((d) => d.name.trim());
  if (plan.mode !== 'team' || !team.length) return plan;
  let p = plan;
  for (let i = 0; i < p.stints.length; i++) {
    if (p.stints[i].driverId) continue;
    const calc = compute(p);
    const sc = calc.stints[i];
    if (!sc || sc.isSurplus) break;
    const prev = calc.stints[i - 1];
    const seat = new Map<string, number>();
    for (const s of calc.active) if (s.stint.driverId) seat.set(s.stint.driverId, (seat.get(s.stint.driverId) ?? 0) + (s.drivenTo - s.start));
    const to = sc.isFinal ? sc.end : sc.pitIn;
    let best: { id: string; score: number } | null = null;
    for (const d of team) {
      const a = availFor(p, d.id, sc.start, to);
      const continuing = prev?.stint.driverId === d.id;
      const run = continuing ? prev.consecutive + 1 : 1;
      let score = AUTO_PREF[a] * 1e6;
      const seatLimit = p.eventKind === 'league' && p.rules.driverTime.enabled ? p.rules.driverTime.maxStintMinutes : 0;
      const seatRun = (continuing ? prev.seatRunMs + (prev.end - prev.drivenTo) : 0) + (sc.pitIn - sc.start);
      if (run > d.maxConsecutive || (seatLimit > 0 && seatRun > seatLimit * MIN)) score += 20e6;
      else if (continuing) score -= 1e6 * 0.5; // a double stint saves a driver swap
      score += (seat.get(d.id) ?? 0) / MIN;
      if (!best || score < best.score) best = { id: d.id, score };
    }
    if (best) {
      const stints = [...p.stints];
      stints[i] = { ...stints[i], driverId: best.id };
      p = normalize({ ...p, stints });
    }
  }
  return p;
}
