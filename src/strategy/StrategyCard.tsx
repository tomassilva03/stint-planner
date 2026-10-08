// The decision engine's call, under Right now on the Stints tab: what to do, what it
// gains, how sure, and why, with every option it weighed. Display only.
import type { RaceCalc } from '../engine';
import type { Plan } from '../model';
import { decide, type Option, type Recommendation } from './decision';
import type { RaceState } from './estimator';

const HEADS: Record<Recommendation['severity'], string> = {
  stable: 'Plan holds',
  change: 'Strategy change',
  critical: 'Fuel won’t last',
};

const secs = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} s`;

function against(r: Recommendation) {
  return r.baseline === r.stay ? 'the plan' : `stopping on lap ${r.baseline.stopLap}`;
}

function vs(o: Option, r: Recommendation) {
  if (o.risky) return `runs dry (${Math.round(o.runDryChance * 100)}% chance)`;
  if (o === r.baseline) return '–';
  return secs(o.gainSec);
}

export function StrategyCard({ plan, calc, race }: { plan: Plan; calc: RaceCalc; race: RaceState }) {
  const r = decide(plan, calc, race);
  if (!r) return null;
  const { best } = r;
  const facts = [
    best !== r.baseline ? `${secs(best.gainSec)} vs ${against(r)}` : null,
    `${best.fuelMarginLaps.toFixed(1)} laps of fuel left ${best.stopLap != null ? 'at the stop' : 'at the flag'}`,
    best.stops ? `${best.stops} stop${best.stops === 1 ? '' : 's'} to the flag` : 'no more stops',
  ].filter(Boolean);
  return (
    <section className={`strategy is-${r.severity}`} aria-label="Strategy" aria-live="polite">
      <div className="race-state-head">
        <h3>{HEADS[r.severity]}</h3>
        <span className="muted">confidence {Math.round(r.confidence * 100)}%</span>
      </div>
      <p className="strategy-call">{best.label}</p>
      <p className="strategy-facts">{facts.join(' · ')}</p>
      {r.reasons.length > 0 && (
        <ul className="strategy-why">
          {r.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <details className="strategy-options">
        <summary>All options</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Option</th>
                <th className="num">Stops on lap</th>
                <th className="num">Fuel at stop</th>
                <th className="num">Stops to flag</th>
                <th className="num">vs {against(r)}</th>
              </tr>
            </thead>
            <tbody>
              {r.options.map((o) => (
                <tr key={o.label} className={o === best ? 'now' : ''}>
                  <td>{o.label}</td>
                  <td className="num">{o.stopLap ?? 'flag'}</td>
                  <td className={`num mono ${o.risky ? 'bad' : ''}`}>{o.fuelMarginLaps.toFixed(1)} laps</td>
                  <td className="num">{o.stops}</td>
                  <td className={`num mono ${o.risky ? 'bad' : o.gainSec >= 0 && o !== r.baseline ? 'good' : ''}`}>{vs(o, r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Each option is played to the flag at the current pace and fuel use, with full-tank stints after the stop and the plan’s stop time. Gains under 5 s
          don’t change the call, and options with more than a 15% chance of running dry aren’t recommended.
        </p>
      </details>
    </section>
  );
}
