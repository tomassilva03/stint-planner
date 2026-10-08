// Pre-race strategy simulator: plays the whole race under a few fuel strategies and
// compares how far each gets before time runs out, how many stops it makes and how
// likely a stint is to come up short of fuel. Pure and deterministic.
import { compute, normalize, type RaceCalc } from '../engine';
import type { Plan, StintType } from '../model';
import { normalCdf } from './stats';

export type StrategyId = 'plan' | 'aggressive' | 'balanced' | 'conservative';
export type Risk = 'Low' | 'Medium' | 'High';

export interface StrategyPreset {
  id: StrategyId;
  name: string;
  description: string;
  /** Laps of fuel kept in hand at every stop */
  reserveLaps: number;
  /** plan: each stint as the plan has it; never: no fuel saving; best: save the whole race if that gets further */
  save: 'plan' | 'never' | 'best';
}

export const PRESETS: StrategyPreset[] = [
  { id: 'plan', name: 'Your plan', description: 'The stints as planned, each tank run to the last full lap.', reserveLaps: 0, save: 'plan' },
  { id: 'aggressive', name: 'Aggressive', description: 'Every tank to the last full lap, saving fuel all race if it saves a stop.', reserveLaps: 0, save: 'best' },
  { id: 'balanced', name: 'Balanced', description: 'Half a lap of fuel in hand at every stop, normal pace.', reserveLaps: 0.5, save: 'never' },
  { id: 'conservative', name: 'Conservative', description: 'A lap and a half of fuel in hand at every stop, normal pace.', reserveLaps: 1.5, save: 'never' },
];

/** How much a stint's average fuel use can differ from the plan's, as a share */
export const FUEL_CV = 0.015;

export interface StrategyResult {
  preset: StrategyPreset;
  /** Laps (with the fraction of a lap) covered when the clock runs out */
  distance: number;
  /** Laps completed at the chequered flag */
  laps: number;
  stops: number;
  /** Laps in each stint, and whether it saves fuel */
  stints: { laps: number; type: StintType }[];
  /** Smallest fuel margin at any planned stop, laps */
  minMarginLaps: number;
  /** Highest chance any one stint comes up short of its stop */
  shortChance: number;
  /** Stints expected to come up short over the race */
  expectedShort: number;
  risk: Risk;
  saving: boolean;
  /** Seconds ahead (+) or behind (−) the recommended strategy at the flag */
  gapSec: number;
}

export interface Simulation {
  results: StrategyResult[];
  recommended: StrategyResult;
}

const riskOf = (p: number): Risk => (p < 0.05 ? 'Low' : p < 0.25 ? 'Medium' : 'High');

/** The plan as it stood before the race: logged ends and laps left out */
function fresh(plan: Plan): Plan {
  return { ...plan, stints: plan.stints.map(({ actualEnd: _e, actualLaps: _l, liveId: _i, lapsAtEnd: _a, ...s }) => s) };
}

/**
 * The plan with a strategy applied: every stint fuel saving or not, and the tank
 * treated as smaller by the reserve, then refilled to the flag. The engine does the
 * rest, so drivers, time of day, planned safety cars and lost time all count.
 */
function variant(plan: Plan, reserveLaps: number, type: StintType): Plan {
  const p = fresh(plan);
  return normalize({ ...p, stints: p.stints.map((s) => ({ ...s, type })), fuel: { ...p.fuel, tankL: p.fuel.tankL - reserveLaps * p.fuel.perLapL } });
}

function result(preset: StrategyPreset, plan: Plan, p: Plan): StrategyResult {
  const calc = compute(p);
  const last = calc.active[calc.active.length - 1];
  // A timed race ends on the lap after time runs out; take off the part run after it
  const over = last ? Math.max(0, (last.pitIn - calc.raceEnd) / 1000) : 0;
  const distance = calc.totalLaps - (last && last.lapTime > 0 ? over / last.lapTime : 0);
  const chances: number[] = [];
  const margins: number[] = [];
  for (const s of calc.active) {
    if (s.isFinal) continue;
    const perLap = plan.fuel.perLapL * (s.stint.type === 'save' ? plan.fuel.saveFuelFactor : 1);
    // Against the real tank: the reserve is fuel kept in hand
    const margin = plan.fuel.tankL / perLap - s.laps;
    margins.push(margin);
    chances.push(normalCdf(-margin / Math.max(0.05, s.laps * FUEL_CV)));
  }
  const shortChance = Math.max(0, ...chances);
  return {
    preset,
    distance,
    laps: calc.totalLaps,
    stops: calc.pitStops,
    stints: calc.active.map((s) => ({ laps: s.laps, type: s.stint.type })),
    minMarginLaps: margins.length ? Math.min(...margins) : 0,
    shortChance,
    expectedShort: chances.reduce((a, b) => a + b, 0),
    risk: riskOf(shortChance),
    saving: calc.active.some((s) => s.stint.type === 'save'),
    gapSec: 0,
  };
}

/** Every preset played over the plan's race, as before the green flag. Null when the plan isn't set up yet. */
export function simulateStrategies(plan: Plan, calc: RaceCalc): Simulation | null {
  if (!calc.valid || !calc.active.length) return null;
  const results = PRESETS.map((preset) => {
    if (preset.save === 'plan') return result(preset, plan, normalize(fresh(plan)));
    const normal = result(preset, plan, variant(plan, preset.reserveLaps, 'standard'));
    if (preset.save === 'never') return normal;
    const saving = result(preset, plan, variant(plan, preset.reserveLaps, 'save'));
    return saving.distance > normal.distance ? saving : normal;
  });
  // The furthest strategy that isn't high risk; nearly equal ones go to the safer
  const lap = calc.baseLapTime;
  const order: Risk[] = ['Low', 'Medium', 'High'];
  const candidates = results.filter((r) => r.preset.id !== 'plan' && r.risk !== 'High');
  const pool = candidates.length ? candidates : results.filter((r) => r.preset.id === 'conservative');
  const recommended = pool.reduce((best, r) => {
    const gain = (r.distance - best.distance) * lap;
    if (gain > 1) return r;
    if (gain > -1 && order.indexOf(r.risk) < order.indexOf(best.risk)) return r;
    return best;
  });
  for (const r of results) r.gapSec = (r.distance - recommended.distance) * lap;
  return { results, recommended };
}
