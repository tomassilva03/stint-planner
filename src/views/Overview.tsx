import { useState } from 'react';
import type { RaceCalc } from '../engine';
import { simMinAt } from '../engine';
import type { Plan } from '../model';
import { clock, dateLabel, dayClock, delta, duration, lapTime, simClock } from '../time';
import { NumberField, Pill } from '../ui';

export interface ViewProps {
  plan: Plan;
  calc: RaceCalc;
  update: (fn: (p: Plan) => Plan) => void;
  tz: (t: number) => number;
  tzName: string;
  now: number;
  go: (tab: string) => void;
}

export function Overview({ plan, calc, tz, tzName, now, go }: ViewProps) {
  if (!calc.valid) {
    return (
      <section className="panel">
        <h2>Finish the race setup</h2>
        <ul className="problems">
          {calc.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <button className="btn primary" onClick={() => go('setup')}>
          Open race setup
        </button>
      </section>
    );
  }
  const last = calc.active[calc.active.length - 1];
  const flagAt = last?.pitIn ?? calc.raceEnd;
  const team = plan.mode === 'team';
  const unassigned = team ? calc.active.filter((s) => !s.stint.driverId).length : 0;
  const blocked = team ? calc.active.filter((s) => s.avail === 'blocked') : [];
  const over = team ? calc.active.filter((s) => s.overPref) : [];
  const lg = calc.league;
  const short = team && !lg ? calc.drivers.filter((d) => !d.meetsFairShare) : [];
  const timeLimits = team && lg && plan.rules.driverTime.enabled;
  const timeIssues = timeLimits ? calc.drivers.filter((d) => d.timeIssue) : [];
  const seatOver = lg ? calc.active.filter((s) => s.overSeatTime) : [];
  const firstTyreOver = lg ? calc.active.find((s) => s.tyreOver) : undefined;
  const rd = plan.rules.driverTime;
  const live = now >= calc.raceStart && now <= flagAt;
  const current = live ? calc.active.find((s) => now >= s.start && now < s.end) : undefined;

  return (
    <div className="stack">
      <section className="stats">
        <Stat label="Green flag" value={clock(calc.raceStart, tz(calc.raceStart))} sub={`${dateLabel(calc.raceStart, tz(calc.raceStart))} · ${tzName}`} />
        <Stat label="Checkered flag" value={clock(flagAt, tz(flagAt))} sub={`${dateLabel(flagAt, tz(flagAt))} · sim ${simClock(simMinAt(plan, flagAt))}`} />
        <Stat label="Race laps" value={`~${calc.totalLaps}`} sub={`at ${lapTime(calc.baseLapTime)} average`} />
        <Stat
          label="Pit stops"
          value={String(calc.pitStops)}
          sub={
            lg?.tyreSetLimit != null
              ? `${calc.active.length} stints · ${lg.tyreSetsUsed} of ${lg.tyreSetLimit} tyre sets`
              : `${calc.active.length} stints · ${calc.tyreChanges} with tyres`
          }
        />
        <Stat label="Laps per tank" value={String(calc.lapsPerStint.standard)} sub={`${calc.lapsPerStint.save} when fuel saving`} />
        <Stat label="Stint length" value={duration(calc.stintTime.standard, false)} sub={`${duration(calc.stintTime.save, false)} fuel saving`} />
      </section>

      {live && current && (
        <section className="panel live">
          <div className="live-row">
            <Pill tone="info">Live</Pill>
            <strong>Stint {current.index}</strong>
            <span>{current.driver?.name ?? 'Unassigned'}</span>
            <span className="muted">
              pits at {clock(current.pitIn, tz(current.pitIn))} ({delta((current.pitIn - now) / 1000).replace('+', 'in ')}), expected back out{' '}
              {clock(current.plannedEnd, tz(current.plannedEnd))}
            </span>
            <button className="link" onClick={() => go('stints')}>
              Log an event
            </button>
            {calc.driftSec !== 0 && <span className={calc.driftSec > 0 ? 'bad' : 'good'}>{delta(calc.driftSec)} against plan</span>}
          </div>
        </section>
      )}

      <Timeline plan={plan} calc={calc} tz={tz} now={now} />

      {(unassigned > 0 || blocked.length > 0 || over.length > 0 || short.length > 0 || timeIssues.length > 0 || seatOver.length > 0 || firstTyreOver || lg?.stopsShort) && (
        <section className="panel">
          <h2>Needs attention</h2>
          <ul className="issues">
            {unassigned > 0 && (
              <li>
                <Pill tone="warn">Driver</Pill> {unassigned} stint{unassigned > 1 ? 's have' : ' has'} no driver.{' '}
                <button className="link" onClick={() => go('stints')}>
                  Assign drivers
                </button>
              </li>
            )}
            {blocked.map((s) => (
              <li key={s.stint.id}>
                <Pill tone="blocked">Blocked</Pill> Stint {s.index}: {s.driver?.name} is unavailable {dayClock(s.start, tz(s.start))}–{clock(s.pitIn, tz(s.pitIn))}.
              </li>
            ))}
            {over.map((s) => (
              <li key={s.stint.id}>
                <Pill tone="tentative">Back to back</Pill> Stint {s.index}: {s.driver?.name}'s {s.consecutive}
                {ordinal(s.consecutive)} stint in a row (prefers {s.driver?.maxConsecutive} max).
              </li>
            ))}
            {lg?.stopsShort && (
              <li>
                <Pill tone="blocked">Pit stops</Pill> The plan has {calc.pitStops} stops; the league requires {lg.minStops}.
              </li>
            )}
            {firstTyreOver && lg?.tyreSetLimit != null && (
              <li>
                <Pill tone="blocked">Tyres</Pill> Stint {firstTyreOver.index} would need set {firstTyreOver.tyreSet}, but only {lg.tyreSetLimit} are allowed. Untick tyres on
                some stops.{' '}
                <button className="link" onClick={() => go('stints')}>
                  Edit stints
                </button>
              </li>
            )}
            {timeIssues.map((d) => (
              <li key={d.driver.id}>
                <Pill tone="blocked">Driver time</Pill> {d.driver.name} drives {duration(d.driveMs / 1000, false)}
                {d.timeIssue === 'under' ? `, under the ${duration(rd.minMinutes * 60, false)} minimum.` : `, over the ${duration(rd.maxMinutes * 60, false)} maximum.`}
              </li>
            ))}
            {seatOver.map((s) => (
              <li key={s.stint.id}>
                <Pill tone="blocked">Time in car</Pill> Stint {s.index}: {s.driver?.name} has been in the car {duration(s.seatRunMs / 1000, false)}, over the{' '}
                {duration(rd.maxStintMinutes * 60, false)} limit.
              </li>
            ))}
            {short.map((d) => (
              <li key={d.driver.id}>
                <Pill tone="warn">Fair share</Pill> {d.driver.name} has {d.laps} laps; needs {calc.fairShareLaps} to score.
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2">
        {team && (
          <section className="panel">
            <h2>Drivers</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th className="num">Stints</th>
                    <th className="num">Laps</th>
                    <th className="num">Seat time</th>
                    {!lg && <th>Fair share</th>}
                    {timeLimits && <th>Time limits</th>}
                  </tr>
                </thead>
                <tbody>
                  {calc.drivers.map((d) => (
                    <tr key={d.driver.id}>
                      <td>
                        <span className="swatch" style={{ background: d.driver.color }} /> {d.driver.name}
                      </td>
                      <td className="num">{d.stints}</td>
                      <td className="num">{d.laps}</td>
                      <td className="num">{duration(d.driveMs / 1000, false)}</td>
                      {!lg && <td>{d.meetsFairShare ? <Pill tone="open">Yes</Pill> : <Pill tone="blocked">No</Pill>}</td>}
                      {timeLimits && (
                        <td>
                          {d.timeIssue === 'under' ? <Pill tone="blocked">Too little</Pill> : d.timeIssue === 'over' ? <Pill tone="blocked">Too much</Pill> : <Pill tone="open">OK</Pill>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!lg && <p className="hint">
              Fair share is 25% of an even split of race laps: {calc.fairShareLaps} laps, about {calc.fairShareStints} full stint
              {calc.fairShareStints === 1 ? '' : 's'} per driver.
            </p>}
          </section>
        )}
        <SaveStop plan={plan} calc={calc} />
        <FuelCalc plan={plan} calc={calc} />
      </div>
    </div>
  );
}

const ordinal = (n: number) => (n === 2 ? 'nd' : n === 3 ? 'rd' : n === 1 ? 'st' : 'th');

function Stat(props: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-sub">{props.sub}</div>
    </div>
  );
}

function Timeline({ plan, calc, tz, now }: Pick<ViewProps, 'plan' | 'calc' | 'tz' | 'now'>) {
  const from = calc.raceStart;
  const last = calc.active[calc.active.length - 1];
  const to = Math.max(calc.raceEnd, last?.end ?? calc.raceEnd);
  const span = to - from;
  const pct = (t: number) => `${((t - from) / span) * 100}%`;
  const hours = Math.round(span / 3_600_000);
  const tickEvery = hours > 12 ? 3 : hours > 4 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let t = from; t <= to; t += tickEvery * 3_600_000) ticks.push(t);
  // Daylight band from the sim clock, sampled every 10 minutes
  const band: { left: string; width: string; light: number }[] = [];
  const step = Math.max(span / 144, 60_000);
  for (let t = from; t < to; t += step) {
    const m = simMinAt(plan, t);
    const light = Math.max(0, Math.cos(((m - 780) / 1440) * 2 * Math.PI));
    band.push({ left: pct(t), width: `${(step / span) * 100 + 0.05}%`, light });
  }
  return (
    <section className="panel">
      <h2>Race timeline</h2>
      <div className="timeline" role="img" aria-label="Stints across the race, coloured by driver">
        <div className="tl-stints">
          {calc.active.map((s) => (
            <div
              key={s.stint.id}
              className={`tl-stint ${s.avail === 'blocked' ? 'is-blocked' : ''}`}
              style={{ left: pct(s.start), width: pct(from + (s.end - s.start)), background: s.driver?.color ?? 'var(--line)' }}
              title={`Stint ${s.index}: ${s.driver?.name ?? 'Unassigned'} ${clock(s.start, tz(s.start))}–${clock(s.end, tz(s.end))}`}
            >
              <span>{s.index}</span>
            </div>
          ))}
        </div>
        <div className="tl-sky" aria-hidden="true">
          {band.map((b, i) => (
            <div key={i} style={{ left: b.left, width: b.width, opacity: 0.15 + b.light * 0.85 }} />
          ))}
        </div>
        <div className="tl-ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {clock(t, tz(t))}
            </span>
          ))}
        </div>
        {now > from && now < to && <div className="tl-now" style={{ left: pct(now) }} title="Now" />}
      </div>
      <div className="legend">
        {plan.mode === 'team' &&
          plan.drivers
            .filter((d) => d.name.trim())
            .map((d) => (
              <span key={d.id}>
                <span className="swatch" style={{ background: d.color }} /> {d.name}
              </span>
            ))}
        <span className="muted">Lower band: in-sim daylight</span>
      </div>
    </section>
  );
}

function SaveStop({ plan, calc }: Pick<ViewProps, 'plan' | 'calc'>) {
  const s = calc.saveStop;
  if (!s) return null;
  const reachable = plan.fuel.perLapL * plan.fuel.saveFuelFactor <= s.targetFuelPerLap;
  return (
    <section className="panel">
      <h2>Save a stop</h2>
      <dl className="kv">
        <dt>Stints needed now</dt>
        <dd>{s.stintsNow}</dd>
        <dt>Target stints</dt>
        <dd>{s.targetStints}</dd>
        <dt>Laps per stint</dt>
        <dd>
          {s.targetLapsPerStint} <span className="muted">({s.lapDelta >= 0 ? '+' : ''}{s.lapDelta} per tank)</span>
        </dd>
        <dt>Fuel per lap</dt>
        <dd>
          {s.targetFuelPerLap.toFixed(3)} L <span className="muted">(now {plan.fuel.perLapL})</span>
        </dd>
        <dt>Saving needed</dt>
        <dd>{(s.savingPct * 100).toFixed(1)}%</dd>
        <dt>Time gained</dt>
        <dd>~{Math.round(s.timeSavedSec)} s of pit time</dd>
      </dl>
      <p className="hint">
        {reachable
          ? 'Your fuel-saving stint setting already burns little enough to do this.'
          : `Your fuel-saving setting saves ${((1 - plan.fuel.saveFuelFactor) * 100).toFixed(1)}%, which is not enough on its own.`}
      </p>
    </section>
  );
}

function FuelCalc({ plan, calc }: Pick<ViewProps, 'plan' | 'calc'>) {
  const [m, setM] = useState(40);
  const row = (label: string, lapFactor: number, fuelFactor: number) => {
    const lt = calc.baseLapTime * lapFactor;
    const laps = lt > 0 ? Math.ceil((m * 60) / lt) : 0;
    const fuel = (laps + 1) * plan.fuel.perLapL * fuelFactor;
    return (
      <tr>
        <td>{label}</td>
        <td className="num">{laps}</td>
        <td className="num">{fuel.toFixed(1)} L</td>
      </tr>
    );
  };
  return (
    <section className="panel">
      <h2>Fuel for a time</h2>
      <div className="inline-field">
        <label htmlFor="fuelcalc-mins">Minutes to cover</label>
        <NumberField id="fuelcalc-mins" className="input short" value={m} min={0} onCommit={setM} />
      </div>
      <p className="hint">Fuel includes one extra lap of margin.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Pace</th>
            <th className="num">Laps</th>
            <th className="num">Fuel</th>
          </tr>
        </thead>
        <tbody>
          {row('Standard', 1, 1)}
          {row('Fuel saving', plan.fuel.saveLapFactor, plan.fuel.saveFuelFactor)}
        </tbody>
      </table>
    </section>
  );
}
