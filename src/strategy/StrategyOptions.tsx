// Pre-race strategy comparison on the Overview tab. Display only: the numbers come
// from the simulator.
import { useMemo } from 'react';
import type { RaceCalc } from '../engine';
import type { Plan } from '../model';
import { Pill } from '../ui';
import { simulateStrategies, type Risk, type StrategyResult } from './simulator';
import './strategy.css';

const TONE: Record<Risk, 'open' | 'tentative' | 'blocked'> = { Low: 'open', Medium: 'tentative', High: 'blocked' };

const gap = (sec: number) => (Math.abs(sec) < 0.5 ? '–' : `${sec > 0 ? '+' : '−'}${Math.abs(sec) < 60 ? `${Math.abs(sec).toFixed(1)} s` : `${(Math.abs(sec) / 60).toFixed(1)} min`}`);

function stintSummary(r: StrategyResult) {
  const full = r.stints.slice(0, -1).map((s) => s.laps);
  if (!full.length) return 'one stint';
  const lo = Math.min(...full);
  const hi = Math.max(...full);
  return `${lo === hi ? lo : `${lo}–${hi}`} laps a stint${r.saving ? ', saving fuel' : ''}`;
}

export function StrategyOptions({ plan, calc }: { plan: Plan; calc: RaceCalc }) {
  const sim = useMemo(() => simulateStrategies(plan, calc), [plan, calc]);
  if (!sim) return null;
  const rec = sim.recommended;
  const mine = sim.results.find((r) => r.preset.id === 'plan')!;
  const verdict =
    Math.abs(mine.gapSec) < 0.5 && mine.risk === rec.risk
      ? 'Your plan matches it.'
      : `Your plan is ${gap(Math.abs(mine.gapSec)).replace(/^[+−]/, '')} ${mine.gapSec >= 0 ? 'ahead' : 'behind'} at the flag with ${mine.risk.toLowerCase()} fuel risk.`;
  return (
    <section className="panel strategy-sim">
      <div className="panel-head">
        <h2>Strategy options</h2>
        <span className="muted">The race played to the flag before the start</span>
      </div>
      <p className="strategy-rec">
        Recommended: <strong>{rec.preset.name}</strong>, {rec.laps} laps and {rec.stops} stops, {rec.risk.toLowerCase()} risk. {verdict}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th className="num">Laps</th>
              <th className="num">Stops</th>
              <th>Stints</th>
              <th className="num">Fuel in hand</th>
              <th>Fuel risk</th>
              <th className="num">vs {rec.preset.name}</th>
            </tr>
          </thead>
          <tbody>
            {sim.results.map((r) => (
              <tr key={r.preset.id} className={r === rec ? 'now' : ''}>
                <td title={r.preset.description}>
                  {r.preset.name}
                  <span className="local">{r.preset.description}</span>
                </td>
                <td className="num">{r.laps}</td>
                <td className="num">{r.stops}</td>
                <td>{stintSummary(r)}</td>
                <td className="num mono">{r.minMarginLaps.toFixed(1)} laps</td>
                <td>
                  <Pill tone={TONE[r.risk]} title={`Up to ${Math.round(r.shortChance * 100)}% chance a stint comes up short of fuel`}>
                    {r.risk}
                  </Pill>
                </td>
                <td className={`num mono ${r.gapSec > 0.5 ? 'good' : r.gapSec < -0.5 ? 'bad' : ''}`}>{gap(r.gapSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Each strategy runs the plan’s drivers, time of day, stop times and planned safety cars and lost time, and is compared by how far the car gets before time
        runs out. Fuel in hand is the least fuel left at any stop. Fuel risk is the chance a stint comes up short if fuel use runs 1.5% off the plan: high risk is
        never recommended. Logged stint times are left out.
      </p>
    </section>
  );
}
