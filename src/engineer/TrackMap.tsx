// The live track map: every car as a dot on the track's shape (or on a ring until the
// shape is known), moved smoothly between the once-a-second readings.
import { useEffect, useRef } from 'react';
import { trackDelta, type FieldCar } from '../live/field';

const SIZE = 1000;
const PAD = 60;
/** Don't guess a car's position further ahead than this, seconds */
const MAX_GUESS = 3;

interface Props {
  cars: FieldCar[];
  ourIdx: number;
  /** Flat [x, y, ...] points in 0..1000, evenly spaced round the lap; null draws a ring */
  points: number[] | null;
  /** Colour cars by class (more than one class in the race) */
  multiClass: boolean;
}

/** Point on the track at a fraction of the lap */
function placer(points: number[] | null) {
  if (!points || points.length < 8) {
    const r = SIZE / 2 - PAD;
    return (pct: number): [number, number] => {
      const a = pct * Math.PI * 2 - Math.PI / 2;
      return [SIZE / 2 + Math.cos(a) * r, SIZE / 2 + Math.sin(a) * r];
    };
  }
  const n = points.length / 2;
  const scale = (SIZE - 2 * PAD) / SIZE;
  return (pct: number): [number, number] => {
    const p = (((pct % 1) + 1) % 1) * n;
    const i = Math.floor(p);
    const j = (i + 1) % n;
    const f = p - i;
    const x = points[i * 2] + (points[j * 2] - points[i * 2]) * f;
    const y = points[i * 2 + 1] + (points[j * 2 + 1] - points[i * 2 + 1]) * f;
    return [PAD + x * scale, PAD + y * scale];
  };
}

/** The track as an SVG path, and the box around it with room for the dots and labels */
function pathOf(place: (pct: number) => [number, number], steps = 300) {
  let d = '';
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k <= steps; k++) {
    const [x, y] = place(k / steps);
    d += `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  }
  const box = `${Math.round(minX - PAD)} ${Math.round(minY - PAD)} ${Math.round(maxX - minX + 2 * PAD)} ${Math.round(maxY - minY + 2 * PAD)}`;
  return { d: d + 'Z', box };
}

interface Motion {
  /** Lap fraction in the latest reading */
  pct: number;
  /** When that reading arrived here, ms */
  at: number;
  /** Laps per second as seen here, from one reading to the next */
  v: number;
  /** Where the dot is drawn now */
  shown: number;
}

/** How quickly a drawn dot catches up with where the car should be, per second */
const CATCH_UP = 6;

export function TrackMap({ cars, ourIdx, points, multiClass }: Props) {
  const place = placer(points);
  const motion = useRef(new Map<number, Motion>());
  const dots = useRef(new Map<number, SVGGElement>());
  const placeRef = useRef(place);
  placeRef.current = place;

  // Each new reading: measure every car's speed between readings, by this page's clock,
  // so cars glide at the right speed however often readings come (and at any demo speed)
  const seen = useRef<FieldCar[] | null>(null);
  if (seen.current !== cars) {
    seen.current = cars;
    const now = performance.now();
    const next = new Map<number, Motion>();
    for (const c of cars) {
      const m = motion.current.get(c.idx);
      if (!m) {
        next.set(c.idx, { pct: c.pct, at: now, v: c.spd, shown: c.pct });
        continue;
      }
      const dt = (now - m.at) / 1000;
      const moved = ((c.pct - m.pct) % 1 + 1) % 1;
      let v = m.v;
      if (dt > 0.05 && moved < 0.25) v = m.v ? m.v * 0.5 + (moved / dt) * 0.5 : moved / dt;
      next.set(c.idx, { pct: c.pct, at: now, v, shown: m.shown });
    }
    motion.current = next;
  }

  // Move the dots every frame, straight in the drawing (no re-render)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      for (const [idx, m] of motion.current) {
        const el = dots.current.get(idx);
        if (!el) continue;
        const target = m.pct + m.v * Math.min(MAX_GUESS, (t - m.at) / 1000);
        // Ease towards it, so a correction never jumps
        m.shown += trackDelta(target, m.shown) * Math.min(1, dt * CATCH_UP);
        const [x, y] = placeRef.current(m.shown);
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [sx, sy] = place(0);
  const [nx, ny] = place(0.004);
  const ang = Math.atan2(ny - sy, nx - sx) + Math.PI / 2;
  const ours = cars.find((c) => c.idx === ourIdx);
  const track = pathOf(place);
  // Ours last, so it is drawn on top
  const drawn = [...cars.filter((c) => c.idx !== ourIdx && !c.out), ...(ours && !ours.out ? [ours] : [])];

  return (
    <svg className="track-map" viewBox={track.box} role="img" aria-label="Track map with every car's position">
      <path d={track.d} className="track-line" />
      <line
        className="track-start"
        x1={sx - Math.cos(ang) * 28}
        y1={sy - Math.sin(ang) * 28}
        x2={sx + Math.cos(ang) * 28}
        y2={sy + Math.sin(ang) * 28}
      />
      {drawn.map((c) => {
        const mine = c.idx === ourIdx;
        const [x, y] = place(motion.current.get(c.idx)?.shown ?? c.pct);
        const fill = mine ? 'var(--now)' : multiClass && c.clsColor ? c.clsColor : 'var(--muted)';
        return (
          <g
            key={c.idx}
            ref={(el) => void (el ? dots.current.set(c.idx, el) : dots.current.delete(c.idx))}
            className={`car${mine ? ' ours' : ''}${c.pit ? ' in-pit' : ''}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <title>{`#${c.num} ${c.team || c.driver} (P${c.clsPos}${multiClass ? ` ${c.clsName}` : ''})${c.pit ? ', in the pits' : ''}`}</title>
            <circle r={mine ? 22 : 15} style={{ fill: c.pit ? 'var(--bg)' : fill, stroke: c.pit ? fill : undefined }} />
            {(mine || (c.clsPos === 1 && !(ours && Math.abs(trackDelta(c.pct, ours.pct)) < 0.04))) && (
              <text y={mine ? -32 : -24} textAnchor="middle">
                {mine ? `#${c.num}` : `P1 ${multiClass ? c.clsName : ''}`.trim()}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
