// Replays a recorded or made-up race through the same path the app uses (detector,
// then the plan updates, then the estimator), stopping at each lap. For tests and
// backtesting; never used by the live page.
import { compute } from '../engine';
import type { Plan } from '../model';
import { applyEvent } from '../live/apply';
import { Detector } from '../live/detector';
import type { LiveEvent, LiveState, Sample } from '../live/protocol';
import { estimateRace, trackLineFuel, type LineFuel, type RaceState } from './estimator';

export interface ReplayStep {
  /** Wall clock of the reading, ms */
  at: number;
  plan: Plan;
  events: LiveEvent[];
  state: LiveState;
  race: RaceState | null;
}

/** Feeds readings in order and yields a step every time a lap is completed */
export function* replay(rows: Iterable<[number, Sample]>, plan: Plan): Generator<ReplayStep> {
  const d = new Detector();
  const events: LiveEvent[] = [];
  let p = plan;
  let line: LineFuel | null = null;
  for (const [at, s] of rows) {
    const out = d.push(s, at);
    line = trackLineFuel(line, d.state());
    if (!out.length) continue;
    events.push(...out);
    for (const ev of out) p = applyEvent(p, ev) ?? p;
    if (out.some((e) => e.kind === 'lap')) {
      const state = d.state();
      yield { at, plan: p, events: [...events], state, race: estimateRace(p, compute(p), events, state, line) };
    }
  }
}
