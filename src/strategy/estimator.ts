// Live estimator: turns the helper's race events and snapshot into the best current
// understanding of the race (RaceState): how fast the car is really going, how much
// fuel it really uses, when it runs dry, and how sure we are.
//
// Estimation only. It never decides anything and never changes the plan; the
// decision engine reads RaceState. Pure and deterministic: the same events give the
// same state, so recorded races replay exactly in tests.
import type { RaceCalc, StintCalc } from '../engine';
import type { Plan } from '../model';
import type { LiveEvent, LiveState } from '../live/protocol';
import { clamp, median, robustMean, robustSpread, theilSen } from './stats';

/** Green laps of this stint needed before its own laps set the pace on their own */
const STINT_MIN_LAPS = 3;
/** Recent laps used for the main pace and fuel numbers */
const WINDOW = 5;
/** Laps used for the race-wide comparison with the plan */
const RACE_WINDOW = 20;
/** Laps used for the pace trend */
const TREND_LAPS = 10;
/** Unknown spread is assumed to be this share of the value */
const DEFAULT_PACE_CV = 0.005;
const DEFAULT_FUEL_CV = 0.03;
/** Even a perfect fuel average can be off this much over a stint (driving, traffic) */
const FUEL_MODEL_CV = 0.01;

export type Source = 'stint' | 'race' | 'plan';

export interface PaceEstimate {
  /** Best estimate of a green lap right now, seconds */
  lapTime: number;
  last: number | null;
  /** Medians of the last 3, 5 and 10 green laps of the race */
  median3: number | null;
  median5: number | null;
  median10: number | null;
  /** Outlier-free average of this stint's green laps */
  stintAvg: number | null;
  /** Seconds per lap the pace is changing by over this stint, + is slowing down */
  trendPerLap: number | null;
  /** The plan's lap time for this stint */
  planned: number;
  /** lapTime minus planned: + is slower than planned */
  deltaVsPlan: number;
  /** Race so far: actual green laps over the plan's lap times, 1.01 = 1% slower */
  ratioToPlan: number | null;
  /** Lap-to-lap spread (robust standard deviation), seconds */
  spread: number | null;
  /** Green laps behind the estimate */
  samples: number;
  source: Source;
}

export interface FuelEstimate {
  /** Litres in the tank: measured on the driving PC, otherwise worked out from laps */
  level: number;
  measured: boolean;
  /** Best estimate of fuel per green lap for this stint, litres */
  perLap: number;
  /** The plan's fuel per lap for this stint */
  planned: number;
  /** perLap vs planned, -0.03 = 3% less than planned */
  deltaPct: number;
  /** Litres, robust standard deviation per lap */
  spread: number | null;
  samples: number;
  source: Source;
  /** Green laps the fuel lasts, counted from the start of the current lap */
  lapsLeft: number;
  /** Last lap the car completes before running dry */
  emptyLap: number;
  /** The lap the plan pits on, or null on the stint to the flag */
  plannedPitLap: number | null;
  /** Stint to the flag: laps still to run */
  lapsToFlag: number | null;
  /** Laps left after reaching the planned stop (or the flag); below 0 it doesn't make it */
  marginLaps: number;
  /** Uncertainty of marginLaps, laps (one standard deviation) */
  marginSigma: number;
}

export interface RaceState {
  lapsCompleted: number;
  /** Index into calc.active of the stint being driven */
  stintIndex: number;
  stint: StintCalc;
  /** Race laps completed before this stint */
  lapsBefore: number;
  /** Laps completed in this stint so far */
  stintLap: number;
  isFinalStint: boolean;
  driverName: string;
  /** Seconds left in the race */
  timeRemaining: number | null;
  caution: boolean;
  onPitRoad: boolean;
  pace: PaceEstimate;
  fuel: FuelEstimate;
  /** 0 to 1: how much to trust these numbers */
  confidence: number;
  /** Plain reasons the confidence is lower, for the UI */
  caveats: string[];
}

interface Lap {
  lap: number;
  lapTime: number | null;
  fuelUsed: number | null;
  green: boolean;
  /** Index into calc.active */
  stint: number;
}

/** Fuel in the tank as the car crossed the line to start the current lap */
export interface LineFuel {
  lap: number;
  level: number;
}

/**
 * Keeps the fuel level from the first reading of each lap. The tank drains through
 * the lap, so counting laps from the line keeps the empty lap from sliding about
 * within a lap. A refuel starts it again from the current level.
 */
export function trackLineFuel(prev: LineFuel | null, state: LiveState | null): LineFuel | null {
  if (!state || state.fuelLevel == null) return null;
  if (!prev || prev.lap !== state.lapsCompleted || state.fuelLevel > prev.level + 0.5) return { lap: state.lapsCompleted, level: state.fuelLevel };
  return prev;
}

/** The race's lap events in order, starting again whenever the lap count goes back (a new session) */
export function raceLaps(events: LiveEvent[]): Extract<LiveEvent, { kind: 'lap' }>[] {
  let out: Extract<LiveEvent, { kind: 'lap' }>[] = [];
  for (const e of events) {
    if (e.kind !== 'lap') continue;
    const prev = out[out.length - 1];
    if (prev && e.lapsCompleted < prev.lapsCompleted) out = [];
    else if (prev && e.lapsCompleted === prev.lapsCompleted) out.pop();
    out.push(e);
  }
  return out;
}

/**
 * Race laps at the end of each finished stint, from what the helper logged; stints
 * logged by hand without laps fall back to their planned laps.
 */
function stintEnds(calc: RaceCalc): number[] {
  const ends: number[] = [];
  let total = 0;
  for (const s of calc.active) {
    if (!s.stint.actualEnd) break;
    total = s.stint.lapsAtEnd ?? total + s.laps;
    ends.push(total);
  }
  return ends;
}

const typeFuel = (plan: Plan, s: StintCalc) => (s.stint.type === 'save' ? plan.fuel.saveFuelFactor : 1);
const quality = (n: number, cv: number, scale: number) => (n / (n + 2)) / (1 + (cv / scale) ** 2);

/**
 * Lap-to-lap spread as a share of the value, from each stint's laps around that
 * stint's own median, so different drivers or a fuel-saving stint don't count as noise.
 */
function pooledCv(values: { stint: number; v: number }[]): number | null {
  const byStint = new Map<number, number[]>();
  for (const x of values) byStint.set(x.stint, [...(byStint.get(x.stint) ?? []), x.v]);
  const residuals: number[] = [];
  for (const vs of byStint.values()) {
    if (vs.length < 2) continue;
    const m = median(vs)!;
    for (const v of vs) residuals.push(v / m - 1);
  }
  return residuals.length >= 3 ? robustSpread(residuals) : null;
}

/**
 * The race as it stands. Null when there is no stint being driven (before the plan
 * is set up, or after the flag).
 */
export function estimateRace(plan: Plan, calc: RaceCalc, events: LiveEvent[], state: LiveState | null, line: LineFuel | null = null): RaceState | null {
  if (!calc.valid) return null;
  const ends = stintEnds(calc);
  const stintIndex = ends.length;
  const stint = calc.active[stintIndex];
  if (!stint) return null;
  const lapsBefore = ends[ends.length - 1] ?? 0;

  const lapEvents = raceLaps(events);
  const stintOf = (lap: number) => {
    const k = ends.findIndex((end) => lap <= end);
    return k < 0 ? stintIndex : k;
  };
  const laps: Lap[] = lapEvents.map((e) => ({ lap: e.lapsCompleted, lapTime: e.lapTime, fuelUsed: e.fuelUsed, green: e.green, stint: stintOf(e.lapsCompleted) }));
  const lastLap = lapEvents[lapEvents.length - 1];
  const lapsCompleted = Math.max(state?.lapsCompleted ?? 0, lastLap?.lapsCompleted ?? 0, lapsBefore);
  const stintLap = Math.max(0, lapsCompleted - lapsBefore);
  const caveats: string[] = [];

  // Pace
  const green = laps.filter((l) => l.green && l.lapTime != null && l.lapTime > 0);
  const times = green.map((l) => l.lapTime!);
  const planned = stint.lapTime;
  const ratios = green.slice(-RACE_WINDOW).map((l) => l.lapTime! / calc.active[l.stint].lapTime);
  const ratioToPlan = ratios.length ? robustMean(ratios, 3, 0.003) : null;
  const stintTimes = green.filter((l) => l.stint === stintIndex).map((l) => l.lapTime!);
  const recent = stintTimes.slice(-WINDOW);
  const floor = 0.003 * planned;
  const stintAvg = stintTimes.length ? robustMean(stintTimes, 3, floor) : null;
  let lapTime: number;
  let paceSource: Source;
  let paceSamples: number[];
  if (recent.length >= STINT_MIN_LAPS) {
    lapTime = robustMean(recent, 3, floor)!;
    paceSource = 'stint';
    paceSamples = recent;
  } else if (ratioToPlan != null) {
    // Too few laps of this stint: lean on how the race has gone against the plan
    const fromRace = planned * ratioToPlan;
    const n = recent.length;
    lapTime = n ? (n * robustMean(recent, 3, floor)! + (STINT_MIN_LAPS - n) * fromRace) / STINT_MIN_LAPS : fromRace;
    paceSource = 'race';
    paceSamples = ratios.slice(-WINDOW).map((r) => r * planned);
  } else {
    lapTime = planned;
    paceSource = 'plan';
    paceSamples = [];
  }
  const trendPts = green
    .filter((l) => l.stint === stintIndex)
    .slice(-TREND_LAPS)
    .map((l) => [l.lap, l.lapTime!] as [number, number]);
  const paceCvPooled = pooledCv(green.slice(-RACE_WINDOW).map((l) => ({ stint: l.stint, v: l.lapTime! })));
  const paceSpread = paceCvPooled != null ? paceCvPooled * lapTime : null;
  const pace: PaceEstimate = {
    lapTime,
    last: lastLap?.lapTime ?? null,
    median3: median(times.slice(-3)),
    median5: median(times.slice(-5)),
    median10: median(times.slice(-10)),
    stintAvg,
    trendPerLap: trendPts.length >= 4 ? theilSen(trendPts) : null,
    planned,
    deltaVsPlan: lapTime - planned,
    ratioToPlan,
    spread: paceSpread,
    samples: paceSamples.length,
    source: paceSource,
  };

  // Fuel per lap: this stint's laps when there are enough, otherwise the race's,
  // scaled for fuel-saving stints so a saving stint doesn't skew a normal one
  const factorNow = typeFuel(plan, stint);
  const plannedFuel = plan.fuel.perLapL * factorNow;
  const fuelLaps = laps.filter((l) => l.green && l.fuelUsed != null && l.fuelUsed > 0);
  const stintFuel = fuelLaps.filter((l) => l.stint === stintIndex).map((l) => l.fuelUsed!).slice(-WINDOW);
  const raceFuel = fuelLaps.slice(-RACE_WINDOW).map((l) => (l.fuelUsed! / typeFuel(plan, calc.active[l.stint])) * factorNow);
  const fuelFloor = 0.01 * plannedFuel;
  let perLap: number;
  let fuelSource: Source;
  let fuelSamples: number[];
  if (stintFuel.length >= STINT_MIN_LAPS) {
    perLap = robustMean(stintFuel, 3, fuelFloor)!;
    fuelSource = 'stint';
    fuelSamples = stintFuel;
  } else if (raceFuel.length) {
    const fromRace = robustMean(raceFuel.slice(-2 * WINDOW), 3, fuelFloor)!;
    const n = stintFuel.length;
    perLap = n ? (n * robustMean(stintFuel, 3, fuelFloor)! + (STINT_MIN_LAPS - n) * fromRace) / STINT_MIN_LAPS : fromRace;
    fuelSource = 'race';
    fuelSamples = raceFuel.slice(-2 * WINDOW);
  } else {
    perLap = plannedFuel;
    fuelSource = 'plan';
    fuelSamples = [];
  }
  const fuelCvPooled = pooledCv(fuelLaps.slice(-RACE_WINDOW).map((l) => ({ stint: l.stint, v: l.fuelUsed! })));
  const fuelSpread = fuelCvPooled != null ? fuelCvPooled * perLap : null;

  const measured = state?.fuelLevel != null;
  const level = measured ? state!.fuelLevel! : Math.max(0, plan.fuel.tankL - stintLap * perLap);
  const fromLine = measured && line && line.lap === lapsCompleted ? line.level : level;
  const lapsLeft = perLap > 0 ? fromLine / perLap : 0;
  const timeRemaining = state?.sessionTimeRemain ?? (lastLap ? Math.max(0, (calc.raceEnd - Date.parse(lastLap.at)) / 1000) : null);
  const isFinalStint = stint.isFinal;
  const plannedPitLap = isFinalStint ? null : lapsBefore + stint.laps;
  // A timed race ends at the line after time runs out
  const lapsToFlag = isFinalStint && timeRemaining != null ? Math.floor(timeRemaining / lapTime) + 1 : null;
  const target = plannedPitLap != null ? Math.max(0, plannedPitLap - lapsCompleted) : lapsToFlag ?? 0;
  const fuelCv = fuelSpread != null && perLap > 0 ? fuelSpread / perLap : DEFAULT_FUEL_CV;
  const relSd = Math.sqrt(fuelCv ** 2 / Math.max(1, fuelSamples.length) + FUEL_MODEL_CV ** 2) * (fuelSource === 'plan' ? 3 : 1);
  const marginSigma = Math.max(0.1, lapsLeft * relSd + (measured ? 0 : 0.5));
  const fuel: FuelEstimate = {
    level,
    measured,
    perLap,
    planned: plannedFuel,
    deltaPct: plannedFuel > 0 ? perLap / plannedFuel - 1 : 0,
    spread: fuelSpread,
    samples: fuelSamples.length,
    source: fuelSource,
    lapsLeft,
    emptyLap: lapsCompleted + Math.floor(lapsLeft + 1e-9),
    plannedPitLap,
    lapsToFlag,
    marginLaps: lapsLeft - target,
    marginSigma,
  };

  // Confidence
  const paceCv = paceSpread != null ? paceSpread / lapTime : DEFAULT_PACE_CV;
  // Borrowing from earlier stints is worth less than this stint's own laps
  let paceQ = paceSource === 'plan' ? 0.25 : quality(Math.max(1, pace.samples), paceCv, 0.01) * (paceSource === 'race' ? 0.8 : 1);
  let fuelQ = fuelSource === 'plan' ? 0.25 : quality(Math.max(1, fuel.samples), fuelCv, 0.03) * (fuelSource === 'race' ? 0.8 : 1);
  if (paceSource === 'plan') caveats.push('No green laps yet, so pace comes from the plan.');
  else if (paceSource === 'race') caveats.push('Too few laps in this stint yet, so pace comes from the race so far.');
  if (fuelSource === 'plan') caveats.push('No fuel readings yet, so fuel use comes from the plan.');
  if (!measured) {
    fuelQ *= 0.7;
    caveats.push('Fuel in the tank is only known on the driving PC, so it is worked out from laps.');
  }
  if (paceCv > 0.01) {
    paceQ *= 0.8;
    caveats.push('Lap times are scattered.');
  }
  const confidence = clamp(Math.sqrt(paceQ * fuelQ), 0, 1);

  return {
    lapsCompleted,
    stintIndex,
    stint,
    lapsBefore,
    stintLap,
    isFinalStint,
    driverName: state?.driverName ?? '',
    timeRemaining,
    caution: state?.caution ?? false,
    onPitRoad: state?.onPitRoad ?? false,
    pace,
    fuel,
    confidence,
    caveats,
  };
}
