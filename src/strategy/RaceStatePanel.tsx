// What the estimator thinks is happening right now, under the live strip on the
// Stints tab. Shows the estimate only; no strategy logic lives here.
import type { RaceCalc } from '../engine';
import type { Plan } from '../model';
import { inRaceWindow } from '../live/apply';
import type { Live } from '../live/useLive';
import { lapTime } from '../time';
import { estimateRace, type RaceState } from './estimator';
import { normalCdf } from './stats';
import './strategy.css';

/** The race state for the page, or null when the live race isn't this plan's race */
export function liveRaceState(live: Live | undefined, plan: Plan, calc: RaceCalc): RaceState | null {
  if (!live || live.status !== 'live' || !live.state?.isRace) return null;
  const last = live.events[live.events.length - 1];
  if (!inRaceWindow(plan, last ? Date.parse(last.at) : Date.now())) return null;
  return estimateRace(plan, calc, live.events, live.state, live.lineFuel);
}

const sign = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

/** Chance the fuel doesn't reach the planned stop (or the flag) */
export const runDryChance = (r: RaceState) => normalCdf(-r.fuel.marginLaps / r.fuel.marginSigma);

function trendText(t: number | null) {
  if (t == null) return 'trend after 4 laps';
  if (Math.abs(t) < 0.05) return 'steady';
  return t > 0 ? `slowing ${t.toFixed(2)} s a lap` : `quicker by ${(-t).toFixed(2)} s a lap`;
}

export function RaceStatePanel({ race }: { race: RaceState }) {
  const { pace, fuel } = race;
  const dry = runDryChance(race);
  const tone = dry > 0.5 ? 'bad' : dry > 0.1 ? 'warn' : 'good';
  const target = fuel.plannedPitLap != null ? `the planned stop on lap ${fuel.plannedPitLap}` : `the flag (${fuel.lapsToFlag ?? '?'} more laps)`;
  const headline = race.onPitRoad
    ? 'In the pits. The fuel numbers pick up again when the car rejoins.'
    : fuel.marginLaps >= 0
      ? `Fuel lasts to lap ${fuel.emptyLap}: ${fuel.marginLaps.toFixed(1)} laps to spare at ${target}.`
      : `Fuel runs out on lap ${fuel.emptyLap}, ${(-fuel.marginLaps).toFixed(1)} laps short of ${target}.`;
  return (
    <section className="race-state" aria-label="Race state">
      <div className="race-state-head">
        <h3>Right now</h3>
        <span className="muted">
          Stint {race.stint.index}, lap {race.stintLap} of the stint · confidence {Math.round(race.confidence * 100)}%
        </span>
      </div>
      <p className={`race-state-line ${race.onPitRoad ? '' : tone}`}>{headline}</p>
      <div className="stats">
        <Stat label="Pace" value={lapTime(pace.lapTime)} sub={`${sign(pace.deltaVsPlan, 2)} s vs plan · ${trendText(pace.trendPerLap)}`} />
        <Stat label="Fuel per lap" value={`${fuel.perLap.toFixed(2)} L`} sub={`${sign(fuel.deltaPct * 100)}% vs plan (${fuel.planned.toFixed(2)} L)`} />
        {!race.onPitRoad && (
          <>
            <Stat label="Fuel left" value={`${fuel.level.toFixed(1)} L`} sub={`${fuel.lapsLeft.toFixed(1)} laps${fuel.measured ? '' : ' · estimated'}`} />
            <Stat label="Runs dry" value={`Lap ${fuel.emptyLap}`} sub={fuel.plannedPitLap != null ? `planned stop lap ${fuel.plannedPitLap}` : `flag in about ${fuel.lapsToFlag ?? '?'} laps`} />
            <Stat label="Fuel margin" value={`${sign(fuel.marginLaps)} laps`} sub={`± ${fuel.marginSigma.toFixed(1)} laps`} tone={tone} />
          </>
        )}
      </div>
      {race.caveats.length > 0 && <p className="hint">{race.caveats.join(' ')}</p>}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value mono ${tone ?? ''}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
