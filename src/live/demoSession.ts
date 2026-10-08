// The demo race played in the browser, for trying the live features without the helper
// (on a Mac, say). It sends the same messages the helper does, so the live strip, the
// stint filling, the strategy card and the Race engineer tab all work the same way.
import { demoRace } from './demo';
import { DemoField, demoOutline } from './demoField';
import { Detector } from './detector';
import { FieldTracker } from './field';
import { PROTOCOL_VERSION, type HelperMessage, type Sample } from './protocol';

/** Demo speeds offered in the planner, as times real speed */
export const DEMO_SPEEDS = [1, 10, 30] as const;

/** How often the snapshot (state and field) goes out, like the helper's 500 ms broadcast */
const SNAPSHOT_MS = 500;
const TICK_MS = 100;

export interface DemoSession {
  stop: () => void;
}

/**
 * Plays the demo race from now at `speed` times real speed, calling `send` with helper messages.
 * Sim time follows the wall clock, so a background tab that runs its timers late catches up.
 * Like the helper, events are stamped with race time (start + seconds since the green flag).
 */
export function playDemo(speed: number, send: (m: HelperMessage) => void, now: () => number = Date.now): DemoSession {
  const start = now();
  const samples = demoRace(0.5);
  const detector = new Detector();
  const field = new FieldTracker();
  const others = new DemoField();
  let next: IteratorResult<[number, Sample]> = samples.next();
  let lastSnapshot = -Infinity;
  let done = false;

  send({ type: 'hello', version: PROTOCOL_VERSION, source: 'demo' });
  send({ type: 'history', events: [] });

  const snapshot = () => {
    send({ type: 'state', state: detector.state() });
    const snap = field.snapshot();
    if (snap) send({ type: 'field', field: snap });
  };

  let outlineSent = false;
  const tick = () => {
    const simT = ((now() - start) / 1000) * speed;
    while (!next.done && next.value[0] <= simT) {
      const [t, s] = next.value;
      for (const event of detector.push(s, start + t * 1000)) send({ type: 'event', event });
      field.push(others.read(t, s));
      if (!outlineSent) {
        send({ type: 'outline', track: s.track, points: demoOutline() });
        outlineSent = true;
      }
      next = samples.next();
    }
    if (next.done && !done) {
      done = true;
      snapshot();
      clearInterval(timer);
      return;
    }
    if (now() - lastSnapshot >= SNAPSHOT_MS) {
      lastSnapshot = now();
      snapshot();
    }
  };
  const timer = setInterval(tick, TICK_MS);
  tick();
  return { stop: () => clearInterval(timer) };
}
