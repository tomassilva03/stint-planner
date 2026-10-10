// Pit stop practice: times stops from the helper's live readings (pit road
// and fuel level, a couple of times a second) and works out what a stop costs.
// Pure, apart from the clock time passed in.
import type { PracticeLap, PracticeStop } from '../model';
import type { LiveState } from '../live/protocol';
import { median } from '../strategy/stats';
import { summarize } from './practice';

/** Longer than this on pit road is a trip to the garage or a break, not a stop */
const MAX_STOP_SEC = 300;
/** Fuel readings jitter a little; a rise smaller than this isn't refuelling */
const FUEL_STEP_L = 0.05;

interface Visit {
  start: number;
  lap: number;
  /** Lowest and highest fuel seen on pit road */
  low: number | null;
  high: number | null;
  firstRise: number | null;
  lastRise: number | null;
  lastFuel: number | null;
}

/** Follows the live readings and hands back a stop each time the car leaves pit road */
export class PitWatcher {
  private visit: Visit | null = null;
  private wasOnPitRoad: boolean | null = null;

  push(s: LiveState, now: number): PracticeStop | null {
    if (!s.connected) return null;
    const was = this.wasOnPitRoad;
    this.wasOnPitRoad = s.onPitRoad;
    // The first reading only tells us where the car is; a visit already under way can't be timed
    if (was == null) return null;
    if (s.onPitRoad && !was) {
      this.visit = { start: now, lap: s.lapsCompleted, low: s.fuelLevel, high: s.fuelLevel, firstRise: null, lastRise: null, lastFuel: s.fuelLevel };
      return null;
    }
    const v = this.visit;
    if (!v) return null;
    if (s.onPitRoad) {
      const f = s.fuelLevel;
      if (f != null) {
        if (v.lastFuel != null && f - v.lastFuel > FUEL_STEP_L / 4) {
          v.firstRise ??= now;
          v.lastRise = now;
        }
        if (v.lastFuel == null || Math.abs(f - v.lastFuel) > FUEL_STEP_L / 4) v.lastFuel = f;
        v.low = v.low == null ? f : Math.min(v.low, f);
        v.high = v.high == null ? f : Math.max(v.high, f);
      }
      return null;
    }
    // Left pit road
    this.visit = null;
    const pitRoadSec = (now - v.start) / 1000;
    if (pitRoadSec > MAX_STOP_SEC) return null;
    const added = v.low != null && v.high != null ? v.high - v.low : 0;
    const fuelAdded = added > FUEL_STEP_L ? Math.round(added * 100) / 100 : 0;
    // The level is read every half second, so the fill took about one reading longer than the rises we saw
    const fillSec = fuelAdded && v.firstRise != null && v.lastRise != null ? Math.round(((v.lastRise - v.firstRise) / 1000 + 0.5) * 10) / 10 : 0;
    return {
      id: `stop-${v.lap}-${new Date(now).toISOString()}`,
      at: new Date(now).toISOString(),
      lap: v.lap,
      pitRoadSec: Math.round(pitRoadSec * 10) / 10,
      fuelAdded,
      fillSec,
      tires: false,
      driver: s.driverName,
    };
  }
}

export interface StopCalc {
  /** In-lap plus out-lap minus two clean laps, seconds; null when those laps weren't recorded */
  lossSec: number | null;
  fillRate: number | null;
}

export interface PitSummary {
  stops: number;
  /** Litres per second, over every stop that took fuel */
  fillRate: number | null;
  /** Time lost driving through pit lane, without the time spent refuelling or changing tyres */
  laneLossSec: number | null;
  /** Extra time a tyre change adds on top of refuelling */
  tireSec: number | null;
  /** Median whole-stop loss, for reference */
  medianLossSec: number | null;
  perStop: Map<string, StopCalc>;
}

/** The lap that ended with this many laps completed */
const lapAt = (laps: PracticeLap[], n: number, after: number) =>
  laps.find((l) => l.lap === n && Math.abs(Date.parse(l.at) - after) < 15 * 60_000 && !!l.lapTime);

export function summarizeStops(stops: PracticeStop[], laps: PracticeLap[]): PitSummary {
  const clean = summarize(laps).medianLap;
  const perStop = new Map<string, StopCalc>();
  for (const s of stops) {
    const at = Date.parse(s.at);
    // Pit road starts on one lap and ends on that lap or the next, so these two laps hold the whole stop
    const inLap = lapAt(laps, s.lap + 1, at);
    const outLap = lapAt(laps, s.lap + 2, at);
    const lossSec = clean && inLap && outLap ? Math.round((inLap.lapTime! + outLap.lapTime! - 2 * clean) * 10) / 10 : null;
    perStop.set(s.id, { lossSec, fillRate: s.fuelAdded && s.fillSec > 1 ? s.fuelAdded / s.fillSec : null });
  }
  const used = stops.filter((s) => !s.excluded);
  const fuelled = used.filter((s) => perStop.get(s.id)!.fillRate != null);
  const fillRate = fuelled.length ? fuelled.reduce((a, s) => a + s.fuelAdded, 0) / fuelled.reduce((a, s) => a + s.fillSec, 0) : null;
  const withLoss = used.filter((s) => perStop.get(s.id)!.lossSec != null);
  const loss = (s: PracticeStop) => perStop.get(s.id)!.lossSec!;
  // Without tyres the car is stationary about as long as it refuels
  const plain = withLoss.filter((s) => !s.tires);
  const laneLossSec = plain.length ? median(plain.map((s) => loss(s) - s.fillSec)) : null;
  const tyred = withLoss.filter((s) => s.tires);
  const tireSec = laneLossSec != null && tyred.length ? Math.max(0, median(tyred.map((s) => loss(s) - laneLossSec - s.fillSec))!) : null;
  return {
    stops: used.length,
    fillRate,
    laneLossSec: laneLossSec == null ? null : Math.round(laneLossSec * 10) / 10,
    tireSec: tireSec == null ? null : Math.round(tireSec * 10) / 10,
    medianLossSec: median(withLoss.map(loss)),
    perStop,
  };
}

/** The plan's stop time: pit lane loss plus filling the tank from empty at the measured rate */
export const stopSecFor = (laneLossSec: number, fillRate: number | null, tankL: number) =>
  Math.round(laneLossSec + (fillRate ? tankL / fillRate : 0));
