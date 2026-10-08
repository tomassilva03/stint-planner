// The live track map: every car as a dot on the track's shape (or on a ring until the
// shape is known), moved smoothly between the once-a-second readings.
import { useEffect, useRef, useState } from 'react';
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
  /** Mirror the map left to right */
  flip: boolean;
}

/** Point on the track at a fraction of the lap */
function placer(points: number[] | null, flip: boolean) {
  const fx = (x: number) => (flip ? SIZE - x : x);
  if (!points || points.length < 8) {
    const r = SIZE / 2 - PAD;
    return (pct: number): [number, number] => {
      const a = pct * Math.PI * 2 - Math.PI / 2;
      return [fx(SIZE / 2 + Math.cos(a) * r), SIZE / 2 + Math.sin(a) * r];
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
    return [fx(PAD + x * scale), PAD + y * scale];
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

export function TrackMap({ cars, ourIdx, points, multiClass, flip }: Props) {
  const place = placer(points, flip);
  const [, setTick] = useState(0);
  const got = useRef({ cars, at: performance.now() });
  if (got.current.cars !== cars) got.current = { cars, at: performance.now() };

  // Redraw about 20 times a second while the page is visible
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 50) {
        last = t;
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const elapsed = Math.min(MAX_GUESS, (performance.now() - got.current.at) / 1000);
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
        const pct = c.pit ? c.pct : c.pct + c.spd * elapsed;
        const [x, y] = place(pct);
        const fill = mine ? 'var(--now)' : multiClass && c.clsColor ? c.clsColor : 'var(--muted)';
        return (
          <g key={c.idx} className={`car${mine ? ' ours' : ''}${c.pit ? ' in-pit' : ''}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
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
