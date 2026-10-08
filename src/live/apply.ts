// Applies race events from the iRacing helper to a plan.
import { compute, raceWindow } from '../engine';
import type { Plan } from '../model';
import type { LiveEvent } from './protocol';

const HOUR = 3600_000;

/** Whether a moment falls in this plan's race (up to an hour after the planned end), when stops fill stints */
export function inRaceWindow(plan: Plan, at: number): boolean {
  const { raceStart, raceEnd } = raceWindow(plan);
  return at > raceStart && at < raceEnd + HOUR;
}

/**
 * A pit exit after a real stop ends the first unfinished stint: it fills the actual
 * end and, when the lap count can be worked out, the actual laps.
 * Returns null when the event doesn't belong to this plan or was already applied.
 */
export function applyPitExit(plan: Plan, ev: LiveEvent): Plan | null {
  if (ev.kind !== 'pitExit' || !ev.stopped) return null;
  if (plan.stints.some((s) => s.liveId === ev.id)) return null;
  const at = Date.parse(ev.at);
  // Only during this plan's race, so an open plan for another event is never touched
  if (!inRaceWindow(plan, at)) return null;
  // The stint after the last one with an actual end
  let i = 0;
  plan.stints.forEach((s, k) => s.actualEnd && (i = k + 1));
  if (i >= plan.stints.length) return null;
  // The final stint ends at the flag, never at a stop
  const calc = compute(plan).stints[i];
  if (!calc || calc.isFinal || calc.isSurplus) return null;

  const prev = plan.stints[i - 1];
  const before = i === 0 ? 0 : prev.lapsAtEnd ?? sumLaps(plan, i);
  const next = structuredClone(plan);
  const st = next.stints[i];
  st.actualEnd = new Date(at).toISOString();
  st.liveId = ev.id;
  st.lapsAtEnd = ev.lapsCompleted;
  if (before != null && ev.lapsCompleted >= before) st.actualLaps = ev.lapsCompleted - before;
  return next;
}

/** Total laps of the first n stints, if every one of them has its actual laps logged */
function sumLaps(plan: Plan, n: number): number | undefined {
  let total = 0;
  for (const s of plan.stints.slice(0, n)) {
    if (s.actualLaps == null) return undefined;
    total += s.actualLaps;
  }
  return total;
}

/** The track name the helper's demo race reports, and the demo plan uses */
export const DEMO_TRACK = 'Demo Raceway';

/**
 * The demo race starts whenever it's picked in the tray, so the demo plan takes its
 * green flag from the demo's first lap. Only before any stint has an actual end.
 */
export function alignDemoStart(plan: Plan, ev: LiveEvent): Plan | null {
  if (ev.kind !== 'lap' || ev.lapsCompleted !== 1 || !ev.lapTime) return null;
  if (plan.event.track !== DEMO_TRACK || plan.stints.some((s) => s.actualEnd)) return null;
  const green = Date.parse(ev.at) - ev.lapTime * 1000;
  if (Math.abs(green - raceWindow(plan).raceStart) < 1000) return null;
  const sessionStart = new Date(green - plan.event.greenFlagOffsetMin * 60_000).toISOString();
  return { ...plan, event: { ...plan.event, sessionStart } };
}

/** Applies one race event; null when it changes nothing */
export function applyEvent(plan: Plan, ev: LiveEvent): Plan | null {
  return alignDemoStart(plan, ev) ?? applyPitExit(plan, ev);
}

/** Applies every event in order; returns the plan unchanged (same object) when nothing applies. */
export function applyEvents(plan: Plan, events: LiveEvent[]): Plan {
  let p = plan;
  for (const ev of events) p = applyEvent(p, ev) ?? p;
  return p;
}
