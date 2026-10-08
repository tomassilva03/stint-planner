import { describe, expect, it } from 'vitest';
import { demoOutline } from '../../src/live/demoField.ts';
import { OUTLINE_POINTS, OutlineRecorder } from './outline.ts';

describe('track outline from one lap', () => {
  it('draws the track the car drove, the right way round', () => {
    // Drive the demo track's shape at a steady 50 m/s, reading heading the way iRacing gives it
    // (radians, anticlockwise from the x axis, y up)
    const shape = demoOutline(1000);
    const pts: [number, number][] = [];
    for (let i = 0; i < shape.length; i += 2) pts.push([shape[i], -shape[i + 1]]);
    const scale = 5; // metres per unit
    let len = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      len += Math.hypot(x1 - x0, y1 - y0) * scale;
    }
    const rec = new OutlineRecorder();
    let out: number[] | null = null;
    let t = 0;
    const speed = 50;
    for (let lap = 0; lap < 3 && !out; lap++) {
      for (let i = 0; i < pts.length && !out; i += 3) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 3) % pts.length];
        const yaw = Math.atan2(y1 - y0, x1 - x0);
        const step = Math.hypot(x1 - x0, y1 - y0) * scale;
        out = rec.push(i / pts.length, speed, yaw, false, t);
        t += step / speed;
      }
    }
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(OUTLINE_POINTS * 2);
    // Same shape as the demo track (both scaled to 0..1000), point for point
    const want = demoOutline(OUTLINE_POINTS);
    let worst = 0;
    for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(want[i] - out![i]));
    expect(worst).toBeLessThan(40);
  });

  it('ignores laps through the pits', () => {
    const rec = new OutlineRecorder();
    let out: number[] | null = null;
    for (let lap = 0; lap < 2; lap++)
      for (let i = 0; i < 200; i++) out = out ?? rec.push(i / 200, 50, (i / 200) * Math.PI * 2, i > 190 || i < 5, lap * 200 + i);
    expect(out).toBeNull();
  });
});
