// The whole field for the Race engineer tab: every car's place on track, the order,
// gaps, pit stops, and the track outline. The helper reads raw positions from iRacing
// (or the demo) and FieldTracker turns them into a snapshot it sends a couple of times
// a second. Pure: no SDK, no clock of its own, so it runs the same in the helper and in tests.

/** One car as read from the sim */
export interface RawCar {
  idx: number;
  number: string;
  /** Who is driving it now */
  driver: string;
  team: string;
  classId: number;
  className: string;
  /** '#rrggbb' */
  classColor: string;
  lapsCompleted: number;
  /** 0 to 1 around the lap, negative when the car isn't on track (in the garage, disconnected) */
  lapPct: number;
  onPitRoad: boolean;
  /** Seconds, null when unknown */
  lastLap: number | null;
  bestLap: number | null;
  /** iRacing's official positions, 0 when not set */
  position: number;
  classPosition: number;
}

export interface RawField {
  sessionTime: number;
  sessionNum: number;
  sessionType: string;
  track: string;
  /** Track length in km, when known */
  trackKm: number | null;
  /** Our team's car */
  ourIdx: number;
  cars: RawCar[];
}

/** One car in a snapshot. Short keys: this goes over the network once a second. */
export interface FieldCar {
  idx: number;
  num: string;
  driver: string;
  team: string;
  cls: number;
  clsName: string;
  clsColor: string;
  /** Live position overall and in class, from distance run (race) or best lap (other sessions) */
  pos: number;
  clsPos: number;
  laps: number;
  pct: number;
  pit: boolean;
  /** Not on track right now (garage, towed, disconnected); shown where it was last seen */
  out: boolean;
  last: number | null;
  best: number | null;
  /** Seconds behind the class leader (race), or best lap difference (other sessions) */
  gap: number | null;
  /** Seconds behind the car ahead in class */
  int: number | null;
  /** Whole laps behind the class leader */
  down: number;
  /** Pit stops made this session */
  pits: number;
  /** Laps completed when it last left the pits */
  pitLap: number | null;
  /** Seconds to our car along the track: positive when this car is ahead of us on the road */
  rel: number | null;
  /** Laps per second, to move the dot smoothly between snapshots */
  spd: number;
}

export interface FieldSnapshot {
  /** Session clock of the reading, seconds */
  t: number;
  sessionType: string;
  track: string;
  trackKm: number | null;
  ourIdx: number;
  cars: FieldCar[];
}

/** Track positions per lap that gaps are measured at */
const CHECKPOINTS = 200;
/** How many laps of crossing times to keep per car */
const KEEP_LAPS = 3;
/** A car that jumps further than this in one reading was towed or reset: don't time it */
const MAX_JUMP = 0.25;

interface Track {
  car: RawCar;
  /** Laps run, including the part lap */
  dist: number;
  at: number;
  seen: boolean;
  crossings: Map<number, number>;
  pits: number;
  pitLap: number | null;
  spd: number;
}

/** Laps run including the part lap. On the grid, behind the line, it is a little below zero. */
export const distance = (laps: number, pct: number) => Math.max(0, laps) + (laps <= 0 && pct > 0.5 ? pct - 1 : pct);

/** Fraction of a lap from b forward to a, in (-0.5, 0.5] */
export const trackDelta = (a: number, b: number) => {
  let d = (a - b) % 1;
  if (d > 0.5) d -= 1;
  if (d <= -0.5) d += 1;
  return d;
};

export class FieldTracker {
  private cars = new Map<number, Track>();
  private session = '';
  private last: RawField | null = null;

  push(f: RawField) {
    const key = `${f.sessionNum}|${f.sessionType}|${f.track}`;
    if (key !== this.session || (this.last && f.sessionTime < this.last.sessionTime - 1)) {
      this.cars.clear();
      this.session = key;
    }
    this.last = f;
    for (const c of f.cars) {
      const onTrack = c.lapPct >= 0;
      let t = this.cars.get(c.idx);
      if (!t) {
        t = { car: c, dist: distance(c.lapsCompleted, Math.max(0, c.lapPct)), at: f.sessionTime, seen: onTrack, crossings: new Map(), pits: 0, pitLap: null, spd: 0 };
        this.cars.set(c.idx, t);
        continue;
      }
      const prev = t.car;
      if (onTrack) {
        const d = distance(c.lapsCompleted, c.lapPct);
        const dt = f.sessionTime - t.at;
        if (t.seen && dt > 0 && d > t.dist && d - t.dist < MAX_JUMP) {
          this.cross(t, t.dist, d, t.at, f.sessionTime);
          const v = (d - t.dist) / dt;
          t.spd = t.spd ? t.spd * 0.7 + v * 0.3 : v;
        } else if (d < t.dist - MAX_JUMP || d - t.dist >= MAX_JUMP) {
          // Reset to the pits or teleported: the old crossings no longer line up
          t.crossings.clear();
        }
        t.dist = d;
        t.at = f.sessionTime;
      }
      t.seen = onTrack;
      if (prev.onPitRoad && !c.onPitRoad && onTrack) {
        t.pits++;
        t.pitLap = c.lapsCompleted;
      }
      if (!onTrack) t.spd = 0;
      t.car = c;
    }
  }

  /** Notes the time the car passed each checkpoint between two readings */
  private cross(t: Track, d0: number, d1: number, t0: number, t1: number) {
    for (let k = Math.floor(d0 * CHECKPOINTS) + 1; k <= Math.floor(d1 * CHECKPOINTS); k++) {
      t.crossings.set(k, t0 + ((k / CHECKPOINTS - d0) / (d1 - d0)) * (t1 - t0));
    }
    const oldest = Math.floor(d1 * CHECKPOINTS) - KEEP_LAPS * CHECKPOINTS;
    for (const k of t.crossings.keys()) {
      if (k >= oldest) break;
      t.crossings.delete(k);
    }
  }

  /** Seconds `behind` is behind `ahead` at the last checkpoint `behind` passed, when both have passed it */
  private timeBehind(ahead: Track, behind: Track, laps = 0): number | null {
    const k = Math.floor(behind.dist * CHECKPOINTS);
    const tb = behind.crossings.get(k);
    const ta = ahead.crossings.get(k + laps * CHECKPOINTS);
    return tb != null && ta != null ? tb - ta : null;
  }

  snapshot(): FieldSnapshot | null {
    const f = this.last;
    if (!f) return null;
    const race = f.sessionType === 'Race';
    const all = [...this.cars.values()].filter((t) => f.cars.some((c) => c.idx === t.car.idx));
    const order = (list: Track[]) =>
      [...list].sort((a, b) =>
        race
          ? b.dist - a.dist || (a.car.position || 999) - (b.car.position || 999)
          : (a.car.bestLap ?? Infinity) - (b.car.bestLap ?? Infinity) || (a.car.position || 999) - (b.car.position || 999),
      );
    const overall = order(all);
    const ours = this.cars.get(f.ourIdx);
    const out: FieldCar[] = [];
    const byClass = new Map<number, Track[]>();
    for (const t of overall) byClass.set(t.car.classId, [...(byClass.get(t.car.classId) ?? []), t]);
    for (const list of byClass.values()) {
      const leader = list[0];
      let ahead: FieldCar | null = null;
      list.forEach((t, i) => {
        const c = t.car;
        const down = race ? Math.max(0, Math.floor(leader.dist - t.dist + 1e-9)) : 0;
        let gap: number | null;
        if (i === 0) gap = race ? 0 : null;
        else if (race) gap = down === 0 ? this.timeBehind(leader, t) : null;
        else gap = c.bestLap != null && leader.car.bestLap != null ? c.bestLap - leader.car.bestLap : null;
        let rel: number | null = null;
        if (ours && t !== ours && t.seen && ours.seen) {
          const delta = trackDelta(t.dist, ours.dist);
          const laps = Math.round(t.dist - delta - ours.dist);
          const timed = delta > 0 ? this.timeBehind(t, ours, laps) : this.timeBehind(ours, t, -laps);
          const lapRef = ours.car.lastLap ?? ours.car.bestLap ?? (ours.spd ? 1 / ours.spd : null);
          rel = timed != null && Math.abs(timed) < 600 ? (delta > 0 ? timed : -timed) : lapRef ? delta * lapRef : null;
        } else if (t === ours) rel = 0;
        const car: FieldCar = {
          idx: c.idx,
          num: c.number,
          driver: c.driver,
          team: c.team,
          cls: c.classId,
          clsName: c.className,
          clsColor: c.classColor,
          pos: overall.indexOf(t) + 1,
          clsPos: i + 1,
          laps: c.lapsCompleted,
          pct: round(t.dist - Math.floor(t.dist), 4),
          pit: c.onPitRoad,
          out: !t.seen,
          last: c.lastLap == null ? null : round(c.lastLap, 3),
          best: c.bestLap == null ? null : round(c.bestLap, 3),
          gap: gap == null ? null : round(gap, 2),
          int: null,
          down,
          pits: t.pits,
          pitLap: t.pitLap,
          rel: rel == null ? null : round(rel, 2),
          spd: round(t.spd, 6),
        };
        if (ahead && car.gap != null && ahead.gap != null && car.down === ahead.down) car.int = round(car.gap - ahead.gap, 2);
        out.push(car);
        ahead = car;
      });
    }
    out.sort((a, b) => a.pos - b.pos);
    return { t: round(f.sessionTime, 2), sessionType: f.sessionType, track: f.track, trackKm: f.trackKm, ourIdx: f.ourIdx, cars: out };
  }
}

const round = (x: number, digits: number) => {
  const m = 10 ** digits;
  return Math.round(x * m) / m;
};

/** iRacing's class colour (a number like 0xffda59) as '#ffda59' */
export const classColor = (n: number | undefined) => (n == null || !Number.isFinite(n) ? '' : `#${(n & 0xffffff).toString(16).padStart(6, '0')}`);

/** Scales track points to fit 0..1000 keeping their shape, as a flat [x, y, x, y...] list */
export function normalise(pts: [number, number][]): number[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  return pts.flatMap(([x, y]) => [Math.round(((x - minX) / size) * 1000), Math.round(((y - minY) / size) * 1000)]);
}
