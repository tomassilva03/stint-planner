// The pit wall's call for the Race engineer tab: box this lap or not, fuel to add, and
// the fuel and stop numbers behind it. Worked out on the PC running the helper (from the
// strategy engine in src/strategy) and sent to teammates in the feed, so everyone sees
// the same call. Pure.
import type { RaceCalc } from '../engine';
import type { Plan } from '../model';
import { decide, type Severity } from '../strategy/decision';
import type { RaceState } from '../strategy/estimator';

export interface CallOption {
  label: string;
  stopLap: number | null;
  fuelMarginLaps: number;
  stops: number;
  gainSec: number;
  risky: boolean;
  best: boolean;
}

export interface PitCall {
  /** Null while the car is in the pits or nothing can be decided */
  severity: Severity | null;
  /** What to do, in words: "Pit this lap", "Stop on lap 24, as planned" */
  call: string | null;
  boxThisLap: boolean;
  stopLap: number | null;
  /** Seconds gained over the plan (or the latest safe stop); null when the call is the plan */
  gainSec: number | null;
  against: string;
  confidence: number;
  reasons: string[];
  options: CallOption[];
  lapsCompleted: number;
  stintLap: number;
  isFinalStint: boolean;
  plannedStopLap: number | null;
  onPitRoad: boolean;
  fuel: {
    level: number;
    measured: boolean;
    perLap: number;
    planned: number;
    deltaPct: number;
    /** Green laps the tank lasts from the start of this lap */
    lapsLeft: number;
    emptyLap: number;
  };
  /** Litres still needed beyond what is in the tank to reach the flag, 0 when the tank covers it */
  toFlagL: number | null;
  /** Litres to put in at the next stop (the recommended one, or the plan's) */
  addAtStopL: number | null;
  /** That stop fills the tank */
  addIsFull: boolean;
  nextDriver: string | null;
  timeRemaining: number | null;
}

/** Fuel kept in hand at the flag when working out a splash, laps */
const SPLASH_MARGIN_LAPS = 0.5;

export function pitCall(plan: Plan, calc: RaceCalc, race: RaceState): PitCall {
  const r = decide(plan, calc, race);
  const { fuel, pace } = race;
  const T = race.timeRemaining;
  const lap = pace.lapTime;
  const perLap = fuel.perLap;
  // A timed race: the car finishes the lap it is on when the clock runs out
  const lapsToFlag = T != null && lap > 0 ? Math.ceil(T / lap) : null;
  const toFlagL = lapsToFlag != null ? Math.max(0, lapsToFlag * perLap - fuel.level) : null;

  const stopLap = r ? r.best.stopLap : fuel.plannedPitLap;
  let addAtStopL: number | null = null;
  let addIsFull = false;
  const tank = plan.fuel.tankL;
  if (race.onPitRoad && T != null && lap > 0) {
    // In the pits now: what this stop should put in
    const need = (Math.ceil(T / lap) + SPLASH_MARGIN_LAPS) * perLap;
    addAtStopL = Math.max(0, Math.min(tank, need) - fuel.level);
    addIsFull = need >= tank;
  } else if (stopLap != null && T != null && lap > 0) {
    const lapsToStop = Math.max(0, stopLap - race.lapsCompleted);
    const atStop = Math.max(0, fuel.level - lapsToStop * perLap);
    const after = T - lapsToStop * lap - plan.pit.stopSec;
    const need = after > 0 ? (Math.ceil(after / lap) + SPLASH_MARGIN_LAPS) * perLap : 0;
    addAtStopL = Math.max(0, Math.min(tank, need) - atStop);
    addIsFull = need >= tank;
  }

  const against = !r ? '' : r.baseline === r.stay ? 'the plan' : `stopping on lap ${r.baseline.stopLap}`;
  const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    severity: r?.severity ?? null,
    call: r?.best.label ?? null,
    boxThisLap: r?.best.lapsToStop === 1,
    stopLap,
    gainSec: r && r.best !== r.baseline ? round(r.best.gainSec, 1) : null,
    against,
    confidence: r ? round(r.confidence) : round(race.confidence),
    reasons: r?.reasons ?? [],
    options: (r?.options ?? []).map((o) => ({
      label: o.label,
      stopLap: o.stopLap,
      fuelMarginLaps: round(o.fuelMarginLaps),
      stops: o.stops,
      gainSec: round(o.gainSec, 1),
      risky: o.risky,
      best: o === r!.best,
    })),
    lapsCompleted: race.lapsCompleted,
    stintLap: race.stintLap,
    isFinalStint: race.isFinalStint,
    plannedStopLap: fuel.plannedPitLap,
    onPitRoad: race.onPitRoad,
    fuel: {
      level: round(fuel.level),
      measured: fuel.measured,
      perLap: round(perLap, 3),
      planned: round(fuel.planned, 3),
      deltaPct: round(fuel.deltaPct, 4),
      lapsLeft: round(fuel.lapsLeft),
      emptyLap: fuel.emptyLap,
    },
    toFlagL: toFlagL == null ? null : round(toFlagL, 1),
    addAtStopL: addAtStopL == null ? null : round(addAtStopL, 1),
    addIsFull,
    nextDriver: calc.active[race.stintIndex + 1]?.driver?.name ?? null,
    timeRemaining: T,
  };
}
