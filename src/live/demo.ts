// Made-up races for trying the live link without iRacing. `demoRace` is the one the
// helper plays: a 70 minute team race that doesn't go to plan, so stints land ahead
// of and behind the demo plan (src/samples/demo.ts). `simpleRace` is an even race
// for tests. Both are deterministic: the same race every time.
import { FLAG_CAUTION, FLAG_CHECKERED, type Sample } from './protocol';

export interface DemoStint {
  driver: string;
  /** Laps before stopping; the last stint runs to the flag instead */
  laps: number;
  /** Typical lap time in seconds; each lap varies a little around it */
  lapTime: number;
  fuelPerLap: number;
  /** Seconds stopped in the pit box at the end of this stint */
  stopSec?: number;
}

export interface DemoScript {
  stints: DemoStint[];
  /** Timed race: the last stint runs until this many seconds have passed, then finishes its lap */
  durationSec?: number;
  /** Laps (counting from 1) run under caution */
  caution?: { fromLap: number; toLap: number };
  /** A drive-through penalty served during this lap */
  driveThroughLap?: number;
  tankL: number;
  /** Largest change in lap time from one lap to the next, seconds (either way) */
  lapJitter?: number;
  seed?: number;
}

/** Seconds on pit road either side of a stop */
export const PIT_LANE_SEC = 20;
const CAUTION_LAP = 1.6;
const CAUTION_FUEL = 0.45;
const DRIVE_THROUGH_SEC = 30;
const DRIVE_THROUGH_LOSS = 20;

/** The helper's demo: what goes wrong is listed per stint */
export const DEMO_SCRIPT: DemoScript = {
  durationSec: 70 * 60,
  tankL: 18.6,
  lapJitter: 0.6,
  seed: 7,
  stints: [
    // A touch quicker than planned
    { driver: 'Driver A', laps: 6, lapTime: 99.5, fuelPerLap: 3, stopSec: 60 },
    // About 1.8 s a lap slower than planned
    { driver: 'Driver B', laps: 6, lapTime: 101.8, fuelPerLap: 3, stopSec: 60 },
    // Saves fuel and stays out a lap longer
    { driver: 'Driver A', laps: 7, lapTime: 100.9, fuelPerLap: 2.6, stopSec: 60 },
    // A safety car (laps 22 to 24), then a slow stop
    { driver: 'Driver B', laps: 6, lapTime: 101, fuelPerLap: 3, stopSec: 85 },
    // A drive-through penalty (lap 28), and stops a lap early
    { driver: 'Driver A', laps: 5, lapTime: 100.3, fuelPerLap: 3, stopSec: 60 },
    // To the flag
    { driver: 'Driver B', laps: 99, lapTime: 100.8, fuelPerLap: 3 },
  ],
  caution: { fromLap: 22, toLap: 24 },
  driveThroughLap: 28,
};

export interface SimpleOptions {
  lapTime?: number;
  lapsPerStint?: number;
  stints?: number;
  stopSec?: number;
  fuelPerLap?: number;
  drivers?: string[];
}

/** An even race: same laps every stint, one caution and one drive-through */
export function simpleScript(o: SimpleOptions = {}): DemoScript {
  const lapsPerStint = o.lapsPerStint ?? 6;
  const n = o.stints ?? 4;
  const drivers = o.drivers ?? ['Driver A', 'Driver B'];
  const fuelPerLap = o.fuelPerLap ?? 3;
  return {
    tankL: fuelPerLap * (lapsPerStint + 1),
    lapJitter: 0,
    stints: Array.from({ length: n }, (_, i) => ({ driver: drivers[i % drivers.length], laps: lapsPerStint, lapTime: o.lapTime ?? 100, fuelPerLap, stopSec: o.stopSec ?? 60 })),
    caution: { fromLap: lapsPerStint + 3, toLap: lapsPerStint + 4 },
    driveThroughLap: lapsPerStint * 2 + 3,
  };
}

/** Small steady random numbers in [0, 1), the same for the same seed */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Segment =
  | { kind: 'lap'; from: number; to: number; lap: number; lapTime: number; fuelFrom: number; fuelTo: number; caution: boolean; driveThrough: number | null; driver: string }
  | { kind: 'pit'; from: number; to: number; stallFrom: number; stallTo: number; fuelFrom: number; fuelTo: number; driver: string; next: string };

/** Lays the race out lap by lap and stop by stop */
export function planRace(script: DemoScript): Segment[] {
  const rnd = random(script.seed ?? 1);
  const jitter = script.lapJitter ?? 0;
  const out: Segment[] = [];
  let t = 0;
  let lap = 0;
  let fuel = script.tankL;
  script.stints.forEach((st, i) => {
    const last = i === script.stints.length - 1;
    for (let k = 0; k < st.laps; k++) {
      if (last && script.durationSec != null && t >= script.durationSec) break;
      lap++;
      const caution = !!script.caution && lap >= script.caution.fromLap && lap <= script.caution.toLap;
      const drive = lap === script.driveThroughLap;
      const pace = st.lapTime + (rnd() * 2 - 1) * jitter;
      const lapTime = Math.round((caution ? pace * CAUTION_LAP : pace + (drive ? DRIVE_THROUGH_LOSS : 0)) * 1000) / 1000;
      const used = st.fuelPerLap * (caution ? CAUTION_FUEL : 1) * (1 + (rnd() * 2 - 1) * 0.02);
      const fuelTo = Math.max(0, fuel - used);
      out.push({ kind: 'lap', from: t, to: t + lapTime, lap, lapTime, fuelFrom: fuel, fuelTo, caution, driveThrough: drive ? t + lapTime / 2 : null, driver: st.driver });
      t += lapTime;
      fuel = fuelTo;
    }
    if (!last) {
      const stop = st.stopSec ?? 60;
      const next = script.stints[i + 1].driver;
      out.push({ kind: 'pit', from: t, to: t + stop + 2 * PIT_LANE_SEC, stallFrom: t + PIT_LANE_SEC, stallTo: t + PIT_LANE_SEC + stop, fuelFrom: fuel, fuelTo: script.tankL, driver: st.driver, next });
      t += stop + 2 * PIT_LANE_SEC;
      fuel = script.tankL;
    }
  });
  return out;
}

/** Yields [seconds since green flag, sample] pairs, one every `step` seconds. */
export function* playRace(script: DemoScript, step = 0.5): Generator<[number, Sample]> {
  const segs = planRace(script);
  // A few seconds past the last line crossing, so its lap time is seen
  const end = segs[segs.length - 1].to + 5;
  let i = 0;
  let laps = 0;
  let lastLap = -1;
  for (let t = 0; t <= end; t += step) {
    while (i < segs.length && t >= segs[i].to) {
      const done = segs[i];
      if (done.kind === 'lap') {
        laps = done.lap;
        lastLap = done.lapTime;
      }
      i++;
    }
    const seg = segs[Math.min(i, segs.length - 1)];
    const over = i >= segs.length;
    const f = over ? 1 : (t - seg.from) / (seg.to - seg.from);
    let onPitRoad = false;
    let inPitStall = false;
    let fuel: number;
    let driverName: string;
    let caution = false;
    if (seg.kind === 'pit' && !over) {
      onPitRoad = true;
      inPitStall = t >= seg.stallFrom && t < seg.stallTo;
      const filled = Math.min(1, Math.max(0, (t - seg.stallFrom) / (seg.stallTo - seg.stallFrom)));
      fuel = seg.fuelFrom + (seg.fuelTo - seg.fuelFrom) * filled;
      // Drivers swap halfway through the stop
      driverName = t >= (seg.stallFrom + seg.stallTo) / 2 ? seg.next : seg.driver;
    } else if (seg.kind === 'lap') {
      fuel = seg.fuelFrom + (seg.fuelTo - seg.fuelFrom) * Math.min(1, f);
      driverName = seg.driver;
      caution = seg.caution && !over;
      onPitRoad = !over && seg.driveThrough != null && t >= seg.driveThrough && t < seg.driveThrough + DRIVE_THROUGH_SEC;
    } else {
      fuel = seg.fuelTo;
      driverName = seg.next;
    }
    yield [
      t,
      {
        sessionTime: 600 + t,
        sessionNum: 2,
        sessionType: 'Race',
        sessionTimeRemain: script.durationSec != null ? Math.max(0, script.durationSec - t) : Math.max(0, end - t),
        lapsCompleted: laps,
        lastLapTime: lastLap,
        onPitRoad,
        inPitStall,
        fuelLevel: Math.max(0, Math.round(fuel * 100) / 100),
        // A timed race shows the chequered flag once time is up; the car finishes at its next crossing
        flags: (caution ? FLAG_CAUTION : 0) | (script.durationSec != null && t >= script.durationSec ? FLAG_CHECKERED : 0),
        driverName,
        track: 'Demo Raceway',
        car: 'Demo GT3',
      },
    ];
  }
}

/** The helper's demo race */
export const demoRace = (step = 0.5) => playRace(DEMO_SCRIPT, step);

/** An even race, for tests */
export const simpleRace = (o: SimpleOptions & { step?: number } = {}) => playRace(simpleScript(o), o.step);
