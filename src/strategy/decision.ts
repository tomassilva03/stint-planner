// Decision engine: given the race state from the estimator, should the car stay on
// the plan, pit now, stay out longer, or save fuel?
//
// Each option is played out to the flag with the same simple race model (current
// pace and fuel use, full-tank stints after the stop, the plan's stop time), and
// options are compared by how far the car gets before time runs out, turned into
// seconds. Fuel risk comes from the estimator's uncertainty. Pure and deterministic.
import type { RaceCalc } from '../engine';
import type { Plan } from '../model';
import type { RaceState } from './estimator';
import { clamp, normalCdf } from './stats';

export type Action = 'stay' | 'pit' | 'extend' | 'save';

export interface Option {
  action: Action;
  label: string;
  /** Laps from now to the stop (1 = box at the end of this lap); null runs to the flag */
  lapsToStop: number | null;
  /** The lap the car stops at the end of, null when it runs to the flag */
  stopLap: number | null;
  /** Fuel left when the car reaches that stop (or the flag), laps */
  fuelMarginLaps: number;
  /** Chance the fuel doesn't get there */
  runDryChance: number;
  /** Stops from now to the flag, this one included */
  stops: number;
  /** Laps (with the fraction of a lap) covered when the clock runs out */
  distance: number;
  /** Seconds gained over staying on the plan; + is better */
  gainSec: number;
  /** Too likely to run dry to recommend */
  risky: boolean;
}

export type Severity = 'stable' | 'change' | 'critical';

export interface Recommendation {
  severity: Severity;
  best: Option;
  /** Staying on the plan */
  stay: Option;
  /** What gains are measured against: the plan, or the latest safe stop when the plan runs dry */
  baseline: Option;
  options: Option[];
  confidence: number;
  reasons: string[];
}

/** Highest chance of running dry an option may have and still be recommended */
export const MAX_RISK = 0.15;
/** Gains smaller than this aren't worth changing the plan for, seconds */
export const MIN_GAIN_SEC = 5;
/** The plan only counts as running dry once that is more likely than not; plans are often sized to the last drop */
export const PLAN_RISK = 0.5;
/** Fuel saving is less predictable than normal running */
const SAVE_SIGMA = 1.3;
const EXTEND_LAPS = [1, 2, 3];

interface Model {
  /** Seconds left in the race */
  T: number;
  /** Litres from the start of this lap */
  fuel: number;
  lap: number;
  fuelPerLap: number;
  saveLap: number;
  saveFuel: number;
  /** Normal pace after the stop at a moment `t` seconds from now */
  laterLap: (t: number) => number;
  laterFuel: number;
  tankL: number;
  /** Laps a full tank lasts after the stop, normal and saving */
  stintLaps: number;
  saveStintLaps: number;
  firstStopSec: number;
  cautionStopSec: number;
  laterStopSec: number;
  caution: boolean;
}

interface Played {
  distance: number;
  stops: number;
  /** Laps run before the stop, or to the flag */
  lapsRun: number;
}

/** Plays the rest of the race: stop after `k` laps (null: run to the flag), saving fuel or not */
function play(m: Model, k: number | null, save: boolean): Played {
  const lap1 = save ? m.lap * m.saveLap : m.lap;
  let t = 0;
  let laps = 0;
  // This stint
  const n1 = k ?? Infinity;
  while (laps < n1) {
    if (t + lap1 >= m.T) return { distance: laps + (m.T - t) / lap1, stops: 0, lapsRun: laps + 1 };
    t += lap1;
    laps++;
  }
  // Stops and full-tank stints to the flag
  let stops = 0;
  let stopSec = k === 1 && m.caution ? m.cautionStopSec : m.firstStopSec;
  const stint = save ? m.saveStintLaps : m.stintLaps;
  for (let guard = 0; guard < 500; guard++) {
    stops++;
    t += stopSec;
    stopSec = m.laterStopSec;
    if (t >= m.T) return { distance: laps, stops, lapsRun: n1 };
    for (let i = 0; i < stint; i++) {
      const lt = m.laterLap(t) * (save ? m.saveLap : 1);
      if (t + lt >= m.T) return { distance: laps + (m.T - t) / lt, stops, lapsRun: n1 };
      t += lt;
      laps++;
    }
  }
  return { distance: laps, stops, lapsRun: n1 };
}

function model(plan: Plan, calc: RaceCalc, race: RaceState): Model | null {
  const T = race.timeRemaining;
  if (T == null || !(T > 0)) return null;
  const cur = race.stint;
  const curIsSave = cur.stint.type === 'save';
  const typeLap = (s: (typeof calc.active)[number]) => (s.stint.type === 'save' ? plan.fuel.saveLapFactor : 1);
  const ratio = race.pace.ratioToPlan ?? 1;
  const now = calc.raceEnd - T * 1000;
  const laterFuel = race.fuel.perLap / (curIsSave ? plan.fuel.saveFuelFactor : 1);
  const full = (perLap: number) => Math.max(1, Math.floor(plan.fuel.tankL / perLap + 1e-9));
  const tyres = (on: boolean) => (on ? plan.pit.tireSec : 0);
  return {
    T,
    fuel: race.fuel.lapsLeft * race.fuel.perLap,
    lap: race.pace.lapTime,
    fuelPerLap: race.fuel.perLap,
    saveLap: curIsSave ? 1 : plan.fuel.saveLapFactor,
    saveFuel: curIsSave ? 1 : plan.fuel.saveFuelFactor,
    laterLap: (t) => {
      const at = now + t * 1000;
      const s = calc.active.find((x) => at >= x.start && at < x.end) ?? calc.active[calc.active.length - 1];
      return (s.lapTime / typeLap(s)) * ratio;
    },
    laterFuel,
    tankL: plan.fuel.tankL,
    stintLaps: full(laterFuel),
    saveStintLaps: full(laterFuel * plan.fuel.saveFuelFactor),
    firstStopSec: plan.pit.stopSec + tyres(cur.stint.tires),
    cautionStopSec: plan.rules.safetyCar.pitSec + tyres(cur.stint.tires),
    laterStopSec: plan.pit.stopSec + tyres(plan.pit.tiresByDefault),
    caution: race.caution,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What to do now. Null when there's nothing to decide (in the pits, no race clock, plan not set up). */
export function decide(plan: Plan, calc: RaceCalc, race: RaceState): Recommendation | null {
  if (race.onPitRoad) return null;
  const m = model(plan, calc, race);
  if (!m) return null;
  const sigma = race.fuel.marginSigma;
  const lapNow = race.lapsCompleted;

  const make = (action: Action, label: string, k: number | null, save: boolean): Option => {
    const p = play(m, k, save);
    const perLap = m.fuelPerLap * (save ? m.saveFuel : 1);
    const fuelMarginLaps = m.fuel / perLap - p.lapsRun;
    const runDryChance = normalCdf(-fuelMarginLaps / (sigma * (save ? SAVE_SIGMA : 1)));
    const reachesStop = k != null && p.stops > 0;
    return {
      action,
      label,
      lapsToStop: reachesStop ? k : null,
      stopLap: reachesStop ? lapNow + k! : null,
      fuelMarginLaps,
      runDryChance,
      stops: p.stops,
      distance: p.distance,
      gainSec: 0,
      risky: runDryChance > (action === 'stay' ? PLAN_RISK : MAX_RISK),
    };
  };

  const final = race.isFinalStint;
  const kStay = final ? null : Math.max(1, (race.fuel.plannedPitLap ?? lapNow + 1) - lapNow);
  const stay = make('stay', final ? 'Run to the flag' : kStay === 1 ? 'Stop this lap, as planned' : `Stop on lap ${lapNow + kStay!}, as planned`, kStay, false);
  const options: Option[] = [stay];
  const add = (o: Option) => {
    if (!options.some((x) => x.lapsToStop === o.lapsToStop && (x.action === 'save') === (o.action === 'save'))) options.push(o);
  };
  /** The last lap this many laps of fuel safely reach */
  const lastSafe = (save: boolean) => {
    const perLap = m.fuelPerLap * (save ? m.saveFuel : 1);
    let k = 1;
    while (k < 400 && normalCdf(-(m.fuel / perLap - (k + 1)) / (sigma * (save ? SAVE_SIGMA : 1))) <= MAX_RISK) k++;
    return k;
  };

  add(make('pit', 'Pit this lap', 1, false));
  if (!final) for (const n of EXTEND_LAPS) add(make('extend', `Stay out ${plural(n, 'more lap')}`, kStay! + n, false));
  // Saving fuel: stretch this stint as far as saved fuel safely goes, and keep saving
  const kSave = lastSafe(true);
  add(make('save', final ? 'Save fuel to the flag' : `Save fuel, stop on lap ${lapNow + kSave}`, final ? null : kSave, true));
  if (stay.risky) {
    const k = lastSafe(false);
    if (k > 1) add(make('pit', `Pit by lap ${lapNow + k}`, k, false));
  }

  // Gains are measured against the plan, or, when the plan runs dry, against the latest safe plain stop
  const plainStop = options.filter((o) => o.action === 'pit' && !o.risky).sort((a, b) => (b.lapsToStop ?? 0) - (a.lapsToStop ?? 0))[0];
  const baseline = stay.risky && plainStop ? plainStop : stay;
  for (const o of options) o.gainSec = (o.distance - baseline.distance) * m.laterLap(0);
  const safe = options.filter((o) => !o.risky);
  const byGain = (a: Option, b: Option) => b.gainSec - a.gainSec || a.stops - b.stops;
  const top = [...safe].sort(byGain)[0];
  const best = top && top.gainSec >= MIN_GAIN_SEC ? top : baseline.risky ? options.find((o) => o.lapsToStop === 1) ?? baseline : baseline;
  // The plan runs dry: say so loudly
  const severity: Severity = stay.risky ? 'critical' : best === stay ? 'stable' : 'change';

  const confidence = clamp(race.confidence * (1 - best.runDryChance), 0, 1);
  return { severity, best, stay, baseline, options, confidence, reasons: reasons(race, calc, best, stay, baseline, m) };
}

function reasons(race: RaceState, calc: RaceCalc, best: Option, stay: Option, baseline: Option, m: Model): string[] {
  const out: string[] = [];
  const { fuel, pace } = race;
  if (stay.risky) {
    out.push(
      stay.stopLap != null
        ? `At ${fuel.perLap.toFixed(2)} L a lap the fuel runs out on lap ${fuel.emptyLap}, before the planned stop on lap ${stay.stopLap}.`
        : `At ${fuel.perLap.toFixed(2)} L a lap the fuel doesn't reach the flag.`,
    );
  }
  if (fuel.source !== 'plan' && Math.abs(fuel.deltaPct) >= 0.02)
    out.push(`Fuel use is ${Math.abs(fuel.deltaPct * 100).toFixed(1)}% ${fuel.deltaPct < 0 ? 'below' : 'above'} the plan.`);
  if (pace.source !== 'plan' && Math.abs(pace.deltaVsPlan) >= 0.3)
    out.push(`Pace is ${Math.abs(pace.deltaVsPlan).toFixed(1)} s a lap ${pace.deltaVsPlan > 0 ? 'slower' : 'quicker'} than planned.`);
  if (fuel.source !== 'plan' && m.stintLaps !== calc.lapsPerStint.standard)
    out.push(`At this fuel use a full tank lasts ${plural(m.stintLaps, 'lap')}, not the planned ${calc.lapsPerStint.standard}.`);
  if (pace.trendPerLap != null) out.push(Math.abs(pace.trendPerLap) < 0.05 ? 'Pace is steady.' : `Lap times are ${pace.trendPerLap > 0 ? 'rising' : 'falling'} by ${Math.abs(pace.trendPerLap).toFixed(2)} s a lap.`);
  if (best !== baseline) {
    const fewer = baseline.stops - best.stops;
    if (fewer > 0 && best.action === 'save') {
      const stopSec = m.laterStopSec;
      out.push(`Saving fuel needs ${plural(fewer, 'fewer stop')}: about ${Math.round(fewer * stopSec)} s in the pits for ${Math.round(fewer * stopSec - best.gainSec)} s of slower laps.`);
    } else if (fewer > 0) out.push(`Needs ${plural(fewer, 'fewer stop')} before the flag.`);
    else if (best.action === 'save' && m.saveStintLaps > m.stintLaps)
      out.push(`Saving fuel makes each full stint ${plural(m.saveStintLaps, 'lap')} instead of ${m.stintLaps}, worth more than the slower laps.`);
    if (best.lapsToStop === 1 && race.caution)
      out.push(`A stop under caution costs about ${Math.round(m.cautionStopSec)} s instead of ${Math.round(m.firstStopSec)} s.`);
  }
  if (best !== stay) {
    if (best.fuelMarginLaps < 1) out.push(`Leaves ${best.fuelMarginLaps.toFixed(1)} laps of fuel in hand.`);
  } else if (!stay.risky) {
    out.push(`No other option gains ${MIN_GAIN_SEC} s or more, so the plan stands.`);
  }
  return out;
}
