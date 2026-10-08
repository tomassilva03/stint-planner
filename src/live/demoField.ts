// The rest of the field for the helper's demo race: 25 made-up cars in three classes
// racing around a made-up track with our car from src/live/demo.ts, so the Race engineer
// tab has a map, standings and relatives to show without iRacing. Deterministic.
import { DEMO_SCRIPT, PIT_LANE_SEC, planRace, type DemoScript } from './demo';
import { normalise, type RawCar, type RawField } from './field';
import type { Sample } from './protocol';
import { SILVERSTONE_GP, toPlane } from './tracks';

/** The slice of the lap the pit lane covers; a car leaving the pits starts its lap this far round */
const PIT_LANE_LAP = 0.015;
const CAUTION_LAP = 1.6;

interface DemoCar {
  idx: number;
  number: string;
  team: string;
  drivers: string[];
  classId: number;
  lapTime: number;
  lapsPerStint: number;
  stopSec: number;
  /** Laps ahead of our car at the green flag (grid spacing) */
  start: number;
}

const CLASSES = [
  { id: 1, name: 'LMP2', color: '#3d8bfd', lap: 92 },
  { id: 2, name: 'GT3', color: '#e8a33d', lap: 100.4 },
  { id: 3, name: 'GT4', color: '#4caf6a', lap: 108 },
];
export const DEMO_CLASS_GT3 = 2;
export const DEMO_OUR_IDX = 7;

/** Our car's grid slot, counting from 0: fifth GT3, behind the five LMP2s */
const OUR_GRID = 5 + 4;

const TEAMS = [
  ['Lisbon Lights', 'R. Costa', 'M. Pires'],
  ['Northbound Motorsport', 'J. Hale', 'S. Okafor'],
  ['Vantage Endurance', 'L. Moreau', 'K. Brandt'],
  ['Redline Collective', 'A. Novak', 'T. Ishikawa'],
  ['Apex Hunters', 'D. Ferreira', 'P. Lund'],
  ['Silverline Racing', 'E. Walsh', 'N. Rossi'],
  ['Blue Hour Racing', 'H. Kim', 'O. Silva'],
  ['Kerb Appeal', 'C. Byrne', 'F. Laine'],
  ['Midnight Oil', 'G. Duarte', 'I. Petrov'],
  ['Late Brakers', 'V. Mendes', 'W. Clarke'],
  ['Pitwall United', 'B. Haas', 'Y. Tanaka'],
  ['Slipstream Society', 'Q. Adams', 'R. Varga'],
  ['Double Stint', 'S. Lopes', 'U. Berg'],
  ['Night Owls', 'Z. Ahmed', 'L. Fontaine'],
  ['Tow Truck Heroes', 'M. Kowalski', 'A. Reyes'],
  ['Fuel Savers', 'J. Lindqvist', 'E. Marques'],
  ['Undercut Racing', 'P. Doyle', 'N. Weber'],
  ['Box Box Box', 'T. Nakamura', 'H. Sousa'],
  ['Long Run', 'K. Jensen', 'D. Moretti'],
  ['Last Light', 'F. Almeida', 'R. Schulz'],
  ['Green Flag Group', 'I. Murphy', 'C. Santos'],
  ['Track Limits', 'O. Nilsen', 'V. Rocha'],
  ['Sector Three', 'W. Fischer', 'G. Bianchi'],
  ['Clean Air', 'Y. Haddad', 'B. Correia'],
  ['Night Shift', 'L. Ortega', 'S. Vidal'],
];

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

function makeCars(): DemoCar[] {
  const rnd = random(11);
  const counts = [5, 11, 9];
  const cars: DemoCar[] = [];
  let idx = 1;
  let grid = 0;
  CLASSES.forEach((cls, ci) => {
    for (let k = 0; k < counts[ci]; k++) {
      // Our car takes a GT3 slot and is played by demo.ts
      if (cls.id === DEMO_CLASS_GT3 && k === 4) {
        grid++;
        continue;
      }
      if (idx === DEMO_OUR_IDX) idx++;
      const [team, ...drivers] = TEAMS[cars.length % TEAMS.length];
      cars.push({
        idx,
        number: String([3, 9, 12, 21, 27, 33, 44, 51, 55, 61, 66, 70, 74, 77, 81, 86, 88, 90, 93, 95, 97, 99, 101, 104, 108][cars.length]),
        team,
        drivers,
        classId: cls.id,
        // Spread the class out, faster cars first
        lapTime: cls.lap + k * 0.28 + rnd() * 0.5,
        lapsPerStint: cls.id === 1 ? 7 : cls.id === 2 ? 6 : 6,
        stopSec: 52 + Math.round(rnd() * 26),
        start: (OUR_GRID - grid) * 0.004,
      });
      idx++;
      grid++;
    }
  });
  return cars;
}


type Seg = { from: number; to: number; lap: number; kind: 'lap' | 'pit'; lapTime: number; outLap: boolean; driver: string };

interface Schedule {
  car: DemoCar;
  segs: Seg[];
}

/** Every lap and stop of a car until it takes the flag */
function schedule(car: DemoCar, script: DemoScript, caution: [number, number] | null): Schedule {
  const rnd = random(car.idx * 97 + 3);
  const segs: Seg[] = [];
  let t = 0;
  let lap = 0;
  let stint = 0;
  let outLap = false;
  const end = script.durationSec ?? 3600;
  // First lap is shorter or longer by the grid offset
  for (;;) {
    lap++;
    let lapTime = car.lapTime + (rnd() * 2 - 1) * 0.6;
    if (caution && t >= caution[0] && t < caution[1]) lapTime *= CAUTION_LAP;
    if (lap === 1) lapTime *= 1 - car.start;
    if (outLap) lapTime *= 1 - PIT_LANE_LAP;
    segs.push({ from: t, to: t + lapTime, lap, kind: 'lap', lapTime, outLap, driver: car.drivers[stint % car.drivers.length] });
    t += lapTime;
    outLap = false;
    if (t >= end) break;
    if (lap % car.lapsPerStint === 0) {
      const stop = car.stopSec + 2 * PIT_LANE_SEC;
      segs.push({ from: t, to: t + stop, lap, kind: 'pit', lapTime: 0, outLap: false, driver: car.drivers[stint % car.drivers.length] });
      t += stop;
      stint++;
      outLap = true;
    }
  }
  return { car, segs };
}

/** Where a schedule puts the car at time t */
function at(segs: Seg[], t: number, start: number) {
  let lastLap: number | null = null;
  let best: number | null = null;
  let seg = segs[0];
  for (const s of segs) {
    if (s.to <= t) {
      if (s.kind === 'lap') {
        const real = s.outLap ? null : s.lapTime;
        lastLap = s.lapTime;
        if (real && s.lap > 1) best = best == null ? real : Math.min(best, real);
      }
      seg = s;
      continue;
    }
    seg = s;
    break;
  }
  const last = segs[segs.length - 1];
  if (t >= last.to) return { laps: last.lap, pct: 0, pit: false, lastLap, best, driver: last.driver };
  const f = Math.max(0, Math.min(1, (t - seg.from) / (seg.to - seg.from)));
  if (seg.kind === 'pit') return { laps: seg.lap, pct: PIT_LANE_LAP * f, pit: true, lastLap, best, driver: seg.driver };
  const from = seg.lap === 1 ? start : seg.outLap ? PIT_LANE_LAP : 0;
  const pct = from + (1 - from) * f;
  return { laps: seg.lap - 1, pct: pct < 0 ? pct + 1 : pct, pit: false, lastLap, best, driver: seg.driver };
}

/** Our car's laps and stops from the demo script, in the same shape */
function ourSchedule(script: DemoScript): Seg[] {
  const out: Seg[] = [];
  let outLap = false;
  let lap = 0;
  for (const s of planRace(script)) {
    if (s.kind === 'pit') {
      out.push({ from: s.from, to: s.to, lap, kind: 'pit', lapTime: 0, outLap: false, driver: s.driver });
      outLap = true;
    } else {
      lap = s.lap;
      out.push({ from: s.from, to: s.to, lap, kind: 'lap', lapTime: s.lapTime, outLap, driver: s.driver });
      outLap = false;
    }
  }
  return out;
}

export class DemoField {
  private others: Schedule[];
  private ours: Seg[];

  constructor(script: DemoScript = DEMO_SCRIPT) {
    this.ours = ourSchedule(script);
    const laps = this.ours.filter((s) => s.kind === 'lap');
    const c = script.caution;
    const window: [number, number] | null = c ? [laps[c.fromLap - 1]?.from ?? 0, laps[c.toLap - 1]?.to ?? 0] : null;
    this.others = makeCars().map((car) => schedule(car, script, window));
  }

  /** The field at `t` seconds after the green flag, with our car taken from the demo's own sample */
  read(t: number, ours: Sample): RawField {
    const classOf = (id: number) => CLASSES.find((c) => c.id === id)!;
    const cars: RawCar[] = this.others.map(({ car, segs }) => {
      const p = at(segs, t, car.start);
      const cls = classOf(car.classId);
      return {
        idx: car.idx,
        number: car.number,
        driver: p.driver,
        team: car.team,
        classId: cls.id,
        className: cls.name,
        classColor: cls.color,
        lapsCompleted: p.laps,
        lapPct: p.pct,
        onPitRoad: p.pit,
        lastLap: p.lastLap,
        bestLap: p.best,
        position: 0,
        classPosition: 0,
      };
    });
    const me = at(this.ours, t, 0);
    const gt3 = classOf(DEMO_CLASS_GT3);
    cars.push({
      idx: DEMO_OUR_IDX,
      number: '42',
      driver: ours.driverName,
      team: 'Nightstint Racing',
      classId: gt3.id,
      className: gt3.name,
      classColor: gt3.color,
      lapsCompleted: ours.lapsCompleted,
      lapPct: me.pct,
      onPitRoad: ours.onPitRoad,
      lastLap: ours.lastLapTime > 0 ? ours.lastLapTime : null,
      bestLap: me.best,
      position: 0,
      classPosition: 0,
    });
    return { sessionTime: ours.sessionTime, sessionNum: ours.sessionNum, sessionType: ours.sessionType, track: ours.track, trackKm: 4.6, ourIdx: DEMO_OUR_IDX, cars };
  }
}

/** The demo track's outline: Silverstone's real layout, as points evenly spaced around the lap */
export function demoOutline(points = 300): number[] {
  return respace(toPlane(SILVERSTONE_GP), points);
}

/** Points along a closed path, `count` of them at equal distances, scaled into 0..1000 */
export function respace(path: [number, number][], count: number): number[] {
  const cum = [0];
  for (let i = 1; i <= path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i % path.length];
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = cum[cum.length - 1];
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = (k / count) * total;
    while (cum[j + 1] < d) j++;
    const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const [x0, y0] = path[j];
    const [x1, y1] = path[(j + 1) % path.length];
    out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
  }
  return normalise(out);
}
