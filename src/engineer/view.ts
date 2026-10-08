// Picks and formats what the Race engineer tab shows from a field snapshot. Pure, for tests.
import { trackDelta, type FieldCar, type FieldSnapshot } from '../live/field';

export interface RelativeRow {
  car: FieldCar;
  /** Seconds: positive ahead of us on the road, negative behind */
  rel: number | null;
  /** Laps this car is ahead (positive) or behind (negative) us in the race, ignoring the road order */
  lapsVsUs: number;
}

/** The cars just ahead of and behind ours on the road, nearest in the middle */
export function relatives(field: FieldSnapshot, each = 3): RelativeRow[] {
  const ours = field.cars.find((c) => c.idx === field.ourIdx);
  if (!ours) return [];
  const usDist = ours.laps + ours.pct;
  const rows = field.cars
    .filter((c) => !c.out)
    .map((c) => {
      const delta = c === ours ? 0 : trackDelta(c.pct, ours.pct);
      const dist = c.laps + c.pct;
      return { car: c, delta, rel: c === ours ? 0 : c.rel, lapsVsUs: Math.round(dist - usDist - delta) };
    });
  const ahead = rows.filter((r) => r.delta > 0).sort((a, b) => a.delta - b.delta).slice(0, each).reverse();
  const behind = rows.filter((r) => r.delta < 0).sort((a, b) => b.delta - a.delta).slice(0, each);
  const me = rows.find((r) => r.car === ours)!;
  return [...ahead, me, ...behind].map(({ car, rel, lapsVsUs }) => ({ car, rel, lapsVsUs }));
}

export interface ClassInfo {
  id: number;
  name: string;
  color: string;
  count: number;
}

export function classes(field: FieldSnapshot): ClassInfo[] {
  const map = new Map<number, ClassInfo>();
  for (const c of field.cars) {
    const k = map.get(c.cls);
    if (k) k.count++;
    else map.set(c.cls, { id: c.cls, name: c.clsName || 'Class', color: c.clsColor, count: 1 });
  }
  return [...map.values()];
}

/** Gap as shown in standings: "+12.4", "+1 lap", "Leader" */
export function gapText(c: FieldCar, race: boolean): string {
  if (c.clsPos === 1) return race ? 'Leader' : '';
  if (c.down > 0) return `+${c.down} lap${c.down > 1 ? 's' : ''}`;
  return c.gap == null ? '' : `+${secs(c.gap)}`;
}

/** 7.25 -> "7.3", 83.2 -> "1:23.2" */
export function secs(s: number): string {
  const a = Math.abs(s);
  if (a < 60) return a.toFixed(1);
  const m = Math.floor(a / 60);
  return `${m}:${(a - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Signed relative gap: "+1.2" ahead, "-0.8" behind */
export const relText = (s: number | null) => (s == null ? '' : s === 0 ? '' : `${s > 0 ? '+' : '-'}${secs(s)}`);

/** The car ahead of and behind ours in class, by position */
export function neighbours(field: FieldSnapshot): { ahead: FieldCar | null; behind: FieldCar | null; ours: FieldCar | null } {
  const ours = field.cars.find((c) => c.idx === field.ourIdx) ?? null;
  if (!ours) return { ahead: null, behind: null, ours };
  const cls = field.cars.filter((c) => c.cls === ours.cls).sort((a, b) => a.clsPos - b.clsPos);
  const i = cls.indexOf(ours);
  return { ours, ahead: cls[i - 1] ?? null, behind: cls[i + 1] ?? null };
}

/** Seconds between two cars in the same class, when both are on the same lap */
export function between(front: FieldCar, back: FieldCar): number | null {
  if (front.down !== back.down || front.gap == null || back.gap == null) return null;
  return back.gap - front.gap;
}
