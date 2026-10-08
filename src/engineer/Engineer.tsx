// The Race engineer tab: follow the race from anywhere. Our car's lap, gaps, fuel and
// pit state, a live track map, the cars around us on the road, and the standings.
import { useState } from 'react';
import type { Plan } from '../model';
import { displayName } from '../live/names';
import type { Live } from '../live/useLive';
import { duration, lapTime } from '../time';
import { Select } from '../ui';
import type { Engineer as EngineerData } from './feed';
import type { PitCall } from './pitCall';
import { TrackMap } from './TrackMap';
import { between, classes, gapText, neighbours, relText, relatives, secs } from './view';
import './engineer.css';

interface Props {
  plan: Plan;
  live: Live;
  engineer: EngineerData;
  signedIn: boolean;
}

export function Engineer({ plan, live, engineer, signedIn }: Props) {
  const { feed, origin } = engineer;
  const [classFilter, setClassFilter] = useState<string>('ours');

  if (!feed) return <NoFeed plan={plan} live={live} engineer={engineer} signedIn={signedIn} />;

  const s = feed.state;
  const field = feed.field;
  const race = (field?.sessionType ?? (s?.isRace ? 'Race' : '')) === 'Race';
  const track = field?.track || s?.track || '';
  const name = (raw: string) => displayName(raw, plan.drivers);
  const { ours, ahead, behind } = field ? neighbours(field) : { ours: null, ahead: null, behind: null };
  const lapsLeft = s?.fuelLevel != null && s.fuelPerLap ? s.fuelLevel / s.fuelPerLap : null;
  const stintLaps = s ? s.lapsCompleted - (feed.team.lastStopLap ?? 0) : null;
  const cls = field ? classes(field) : [];
  const multiClass = cls.length > 1;
  const shownClass = classFilter === 'ours' ? ours?.cls ?? null : classFilter === 'all' ? null : Number(classFilter);
  const standings = field ? field.cars.filter((c) => shownClass == null || c.cls === shownClass) : [];
  const rel = field ? relatives(field, 4) : [];

  return (
    <div className="engineer">
      <div className={`live-strip is-live engineer-status`} role="status">
        <span className="live-dot" aria-hidden />
        <strong className="live-label">
          {origin === 'local' ? (feed.source === 'demo' ? 'Live from this PC (demo race)' : 'Live from this PC') : `Live from ${s?.driverName ? `${name(s.driverName)}'s car` : 'a teammate'}`}
        </strong>
        {track && <span>{track}</span>}
        {s?.caution && <span className="live-flag">Caution</span>}
        {s?.sessionTimeRemain != null && <span className="muted">{duration(s.sessionTimeRemain)} left</span>}
        <span className="muted">{shareNote(engineer, signedIn)}</span>
      </div>

      {feed.call ? (
        <CallPanel call={feed.call} />
      ) : (
        s?.isRace && (
          <p className="hint">
            {origin === 'local'
              ? 'No pit call: this race isn’t the one this plan is for. Open the plan for this race (or “Demo race” from the plan menu for the demo).'
              : 'No pit call from the driving PC yet: it needs this plan open during its race.'}
          </p>
        )
      )}

      <section className="panel engineer-car" aria-label="Our car">
        <dl className="eng-stats">
          <Stat k="Position" v={ours ? `P${ours.clsPos}${multiClass ? ` ${ours.clsName}` : ''}` : '–'} sub={ours && multiClass ? `P${ours.pos} overall` : undefined} />
          <Stat k="Lap" v={s ? String(s.lapsCompleted) : '–'} sub={stintLaps != null ? `${stintLaps} this stint` : undefined} />
          <Stat k="Last lap" v={s?.lastLapTime ? lapTime(s.lastLapTime) : '–'} sub={s?.avgLapTime ? `avg ${lapTime(s.avgLapTime)}` : undefined} />
          <Stat k="Ahead in class" v={ahead && ours ? gapOrLaps(ahead, ours) : '–'} sub={ahead ? `#${ahead.num} ${ahead.team || name(ahead.driver)}` : undefined} />
          <Stat k="Behind in class" v={behind && ours ? gapOrLaps(ours, behind) : '–'} sub={behind ? `#${behind.num} ${behind.team || name(behind.driver)}` : undefined} />
          <Stat
            k="Fuel"
            v={s?.fuelLevel != null ? `${s.fuelLevel.toFixed(1)} L` : '–'}
            sub={lapsLeft != null ? `${lapsLeft.toFixed(1)} laps at ${s!.fuelPerLap!.toFixed(2)} L` : s?.fuelLevel == null ? 'only the driving PC sees fuel' : undefined}
            warn={lapsLeft != null && lapsLeft < 2}
          />
          <Stat
            k="Pit"
            v={s?.onPitRoad ? 'In the pits' : 'On track'}
            sub={`${feed.team.stops} stop${feed.team.stops === 1 ? '' : 's'}${feed.team.lastStopSec != null ? `, last ${Math.round(feed.team.lastStopSec)} s on lap ${feed.team.lastStopLap}` : ''}`}
            now={s?.onPitRoad}
          />
          <Stat k="Driver" v={s?.driverName ? name(s.driverName) : '–'} />
        </dl>
      </section>

      {!field ? (
        <p className="hint">
          No standings, relatives or track map from this helper. It may be an older version (it updates itself from the tray, or restart it), or it is
          playing back a recording made before they existed.
        </p>
      ) : (
        <div className="engineer-grid">
          <section className="panel">
            <h2>Track</h2>
            <TrackMap cars={field.cars} ourIdx={field.ourIdx} points={engineer.outline?.points ?? null} multiClass={multiClass} />
            {!engineer.outline && <p className="hint">The track's shape is drawn after the driving PC completes a clean lap. Until then cars run on a ring.</p>}
            {multiClass && (
              <p className="eng-legend">
                {cls.map((c) => (
                  <span key={c.id}>
                    <i style={{ background: c.color || 'var(--muted)' }} />
                    {c.name}
                  </span>
                ))}
                <span>
                  <i className="ours" />
                  Us
                </span>
              </p>
            )}

            <h2 className="eng-sub">Relative</h2>
            <div className="table-wrap">
              <table className="table eng-table">
                <tbody>
                  {rel.map(({ car, rel: r, lapsVsUs }) => {
                    const mine = car.idx === field.ourIdx;
                    return (
                      <tr key={car.idx} className={`${mine ? 'ours' : ''}${car.pit ? ' in-pit' : ''}`}>
                        <td className="num mono eng-rel">{mine ? '' : relText(r)}</td>
                        <td className="mono">
                          {multiClass && <i className="cls-dot" style={{ background: car.clsColor || 'var(--muted)' }} />}#{car.num}
                        </td>
                        <td className="eng-name">
                          {mine ? name(car.driver) : car.driver}
                          {car.pit && <span className="eng-pit">Pit</span>}
                        </td>
                        <td className="muted">{lapsVsUs > 0 ? `${lapsVsUs} lap${lapsVsUs > 1 ? 's' : ''} up` : lapsVsUs < 0 ? `${-lapsVsUs} lap${lapsVsUs < -1 ? 's' : ''} down` : ''}</td>
                        <td className="num muted">
                          P{car.clsPos}
                          {multiClass ? ` ${car.clsName}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {feed.team.laps.length > 0 && (
              <>
                <h2 className="eng-sub">Our last laps</h2>
                <div className="table-wrap">
                  <table className="table eng-table">
                    <thead>
                      <tr>
                        <th>Lap</th>
                        <th className="num">Time</th>
                        <th className="num">Fuel</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...feed.team.laps].reverse().map((l) => (
                        <tr key={l.lap}>
                          <td className="mono">{l.lap}</td>
                          <td className="num mono">{l.time ? lapTime(l.time) : '–'}</td>
                          <td className="num mono">{l.fuel != null ? `${l.fuel.toFixed(2)} L` : '–'}</td>
                          <td className="muted">{l.green ? '' : 'not a green lap'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Standings</h2>
              {multiClass && (
                <Select
                  ariaLabel="Class"
                  value={classFilter}
                  onChange={setClassFilter}
                  options={[
                    { value: 'ours', label: ours ? `Our class (${ours.clsName})` : 'Our class' },
                    { value: 'all', label: 'All classes' },
                    ...cls.map((c) => ({ value: String(c.id), label: `${c.name} (${c.count})` })),
                  ]}
                />
              )}
            </div>
            <div className="table-wrap">
              <table className="table eng-table">
                <thead>
                  <tr>
                    <th className="num">Pos</th>
                    <th>#</th>
                    <th>Team</th>
                    <th className="num">{race ? 'Gap' : 'Best'}</th>
                    {race && <th className="num">Int</th>}
                    <th className="num">Last</th>
                    {race && <th className="num">Pits</th>}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((c) => {
                    const mine = c.idx === field.ourIdx;
                    return (
                      <tr key={c.idx} className={`${mine ? 'ours' : ''}${c.out ? ' out' : ''}`}>
                        <td className="num mono">{shownClass == null ? c.pos : c.clsPos}</td>
                        <td className="mono">
                          {multiClass && <i className="cls-dot" style={{ background: c.clsColor || 'var(--muted)' }} />}
                          {c.num}
                        </td>
                        <td className="eng-name">
                          <span>{c.team || c.driver}</span>
                          {c.team && <span className="muted"> {mine ? name(c.driver) : c.driver}</span>}
                          {c.pit && <span className="eng-pit">Pit</span>}
                        </td>
                        <td className="num mono">{race ? gapText(c, race) : c.best ? lapTime(c.best) : ''}</td>
                        {race && <td className="num mono">{c.int != null ? secs(c.int) : ''}</td>}
                        <td className="num mono">{c.last ? lapTime(c.last) : ''}</td>
                        {race && <td className="num mono">{c.pits || ''}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function gapOrLaps(front: NonNullable<ReturnType<typeof neighbours>['ours']>, back: NonNullable<ReturnType<typeof neighbours>['ours']>) {
  const s = between(front, back);
  if (s != null) return `${secs(s)} s`;
  const laps = back.down - front.down;
  return laps > 0 ? `${laps} lap${laps > 1 ? 's' : ''}` : '–';
}

const HEADS = { stable: 'Plan holds', change: 'Strategy change', critical: 'Fuel won’t last' } as const;

/** Box this lap or not, with the fuel and stop numbers behind it */
function CallPanel({ call: c }: { call: PitCall }) {
  const f = c.fuel;
  const litres = (x: number) => `${x.toFixed(1)} L`;
  const head = c.onPitRoad ? 'In the pits' : c.severity ? HEADS[c.severity] : 'Pit call';
  const line = c.onPitRoad ? `Fill ${c.addAtStopL != null ? litres(c.addAtStopL) : '–'}${c.addIsFull ? ' (full tank)' : ''}` : c.boxThisLap ? 'Box this lap' : c.call ?? '–';
  const facts = [
    c.gainSec != null ? `${c.gainSec >= 0 ? '+' : '−'}${Math.abs(c.gainSec).toFixed(1)} s vs ${c.against}` : null,
    c.severity ? `confidence ${Math.round(c.confidence * 100)}%` : null,
  ].filter(Boolean);
  const urgent = c.boxThisLap || c.severity === 'critical';
  return (
    <section className={`panel eng-call is-${c.severity ?? 'pit'}${urgent ? ' urgent' : ''}`} aria-label="Pit call" aria-live="polite">
      <div className="eng-call-head">
        <span className="muted">{head}</span>
        <strong className="eng-call-line">{line}</strong>
        {facts.length > 0 && <span className="muted">{facts.join(' · ')}</span>}
      </div>
      <dl className="eng-stats eng-fuel">
        <Stat
          k="Fuel lasts"
          v={`${f.lapsLeft.toFixed(1)} laps`}
          sub={`dry after lap ${f.emptyLap}${f.measured ? '' : ', estimated'}`}
          warn={c.plannedStopLap != null && f.emptyLap < c.plannedStopLap}
        />
        <Stat
          k="Per lap"
          v={`${f.perLap.toFixed(2)} L`}
          sub={Math.abs(f.deltaPct) >= 0.005 ? `${Math.abs(f.deltaPct * 100).toFixed(1)}% ${f.deltaPct < 0 ? 'under' : 'over'} plan (${f.planned.toFixed(2)})` : 'on plan'}
        />
        <Stat k="To the flag" v={c.toFlagL == null ? '–' : c.toFlagL > 0 ? `+${litres(c.toFlagL)}` : 'Covered'} sub={c.toFlagL ? 'more than is in the tank' : c.toFlagL === 0 ? 'enough fuel to finish' : undefined} />
        {!c.onPitRoad && (
          <Stat
            k="Next stop"
            v={c.stopLap != null ? `Lap ${c.stopLap}` : c.isFinalStint ? 'None' : '–'}
            sub={c.stopLap != null ? [c.stopLap - c.lapsCompleted === 1 ? 'this lap' : `in ${c.stopLap - c.lapsCompleted} laps`, c.plannedStopLap != null && c.plannedStopLap !== c.stopLap ? `plan said ${c.plannedStopLap}` : null].filter(Boolean).join(', ') : 'running to the flag'}
            now={c.boxThisLap}
          />
        )}
        <Stat k="Add at the stop" v={c.addAtStopL != null ? litres(c.addAtStopL) : '–'} sub={c.addAtStopL != null ? (c.addIsFull ? 'full tank' : 'just enough for the flag') : undefined} />
        <Stat k="Next driver" v={c.nextDriver ?? '–'} sub={`lap ${c.stintLap} of this stint`} />
      </dl>
      {c.reasons.length > 0 && (
        <ul className="eng-why">
          {c.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {c.options.length > 1 && (
        <details className="eng-options">
          <summary>Options weighed</summary>
          <div className="table-wrap">
            <table className="table eng-table">
              <thead>
                <tr>
                  <th>Option</th>
                  <th className="num">Stop on lap</th>
                  <th className="num">Fuel left at stop</th>
                  <th className="num">Stops to flag</th>
                  <th className="num">vs {c.against}</th>
                </tr>
              </thead>
              <tbody>
                {c.options.map((o) => (
                  <tr key={o.label} className={o.best ? 'ours' : ''}>
                    <td>{o.label}</td>
                    <td className="num">{o.stopLap ?? 'flag'}</td>
                    <td className="num mono">{o.fuelMarginLaps.toFixed(1)} laps</td>
                    <td className="num">{o.stops}</td>
                    <td className="num mono">{o.risky ? 'runs dry' : `${o.gainSec >= 0 ? '+' : '−'}${Math.abs(o.gainSec).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function shareNote(e: EngineerData, signedIn: boolean) {
  if (e.origin === 'local') {
    if (e.sending) return 'Teammates on this plan see it too';
    if (!signedIn) return 'Sign in to share it with teammates';
    if (e.share === 'local-plan') return 'Save this plan to your account to share it with teammates';
    if (e.share === 'error') return 'Could not share it with teammates';
    return 'Connecting to teammates…';
  }
  return '';
}

function Stat({ k, v, sub, warn, now }: { k: string; v: string; sub?: string; warn?: boolean; now?: boolean }) {
  return (
    <div className={`eng-stat${warn ? ' warn' : ''}${now ? ' now' : ''}`}>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
      {sub && <dd className="eng-stat-sub">{sub}</dd>}
    </div>
  );
}

function NoFeed({ plan, live, engineer, signedIn }: Props) {
  const share = engineer.share;
  return (
    <div className="engineer">
      <section className="panel">
        <h2>No live race right now</h2>
        <p className="hint">
          This tab follows the race as it happens: a track map with every car, the standings, the cars around ours on the road, and our lap times, gaps, fuel and pit
          stops.
        </p>
        <ul className="eng-steps">
          <li>
            On the PC running iRacing, run the Nightstint helper and open this plan.{' '}
            {live.status === 'off' ? (
              <button className="btn tiny" onClick={live.enable}>
                Connect to the helper on this PC
              </button>
            ) : live.status === 'waiting' ? (
              <span className="muted">The helper on this PC is running and waiting for iRacing.</span>
            ) : (
              <span className="muted">Looking for the helper on this PC…</span>
            )}
          </li>
          <li>
            Teammates who aren't driving open the same plan here and see the race from that PC.{' '}
            <span className="muted">
              {!signedIn
                ? 'Everyone needs to be signed in, with the plan shared to them.'
                : share === 'local-plan'
                  ? `“${plan.name}” only lives in this browser: save it to your account and share it first.`
                  : share === 'error'
                    ? 'Could not join this plan’s live channel. The database may need the latest schema.'
                    : share === 'on'
                      ? 'Listening for a teammate’s PC on this plan.'
                      : 'Connecting…'}
            </span>
          </li>
          <li>
            To try it without iRacing, pick “Demo race” from the plan menu: it plays a made-up race right here in the browser.
          </li>
        </ul>
      </section>
    </div>
  );
}
