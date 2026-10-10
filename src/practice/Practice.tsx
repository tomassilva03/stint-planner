// Practice tab: records laps from the iRacing helper and turns them into the
// plan's lap time and fuel per lap.
import { useState } from 'react';
import { baseLapTime } from '../engine';
import type { Plan } from '../model';
import { displayName } from '../live/names';
import type { Live } from '../live/useLive';
import { lapTime } from '../time';
import { Select } from '../ui';
import { summarizeStops } from './pits';
import { setPitTimes } from '../model';
import { applyFuel, applyPace, byDriver, roundFuel, roundLap, summarize, type LapStatus } from './practice';
import './practice.css';

const STATUS_LABEL: Record<LapStatus, string> = {
  clean: 'Clean',
  inout: 'In/out lap or caution',
  outlier: 'Outlier',
  excluded: 'Left out',
  notime: 'No lap time',
};

interface Props {
  plan: Plan;
  update: (fn: (p: Plan) => Plan) => void;
  live: Live;
  readOnly: boolean;
}

export function Practice({ plan, update, live, readOnly }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [applied, setApplied] = useState('');
  const { recording, laps } = plan.practice;
  const all = summarize(laps);
  const groups = byDriver(laps, plan.drivers);
  const team = plan.mode === 'team';
  const s = live.state;

  const setPractice = (fn: (p: Plan['practice']) => Plan['practice']) => update((p) => ({ ...p, practice: fn(p.practice) }));
  const done = (msg: string) => {
    setApplied(msg);
    setTimeout(() => setApplied(''), 4000);
  };

  const stops = plan.practice.stops;
  const pit = summarizeStops(stops, laps);
  // What the measured figures would make of the plan's pit times
  const measured = {
    laneLossSec: pit.laneLossSec != null && pit.laneLossSec > 0 ? pit.laneLossSec : undefined,
    fillRate: pit.fillRate ? Math.round(pit.fillRate * 100) / 100 : undefined,
    tireSec: pit.tireSec ?? undefined,
  };
  const canApply = measured.laneLossSec != null || measured.fillRate != null || measured.tireSec != null;
  const after = setPitTimes(plan, measured).pit;
  const fuel = all.avgFuel;
  const planPace = baseLapTime(plan);

  return (
    <div className="stack practice">
      <section className="panel">
        <div className="panel-head">
          <h2>Practice</h2>
          {!readOnly && (
            <span className="practice-actions">
              {recording ? (
                <button className="btn on" onClick={() => setPractice((p) => ({ ...p, recording: false }))}>
                  <span className="rec-dot" aria-hidden /> Recording · stop
                </button>
              ) : (
                <button className="btn primary" onClick={() => setPractice((p) => ({ ...p, recording: true }))}>
                  Start recording laps
                </button>
              )}
            </span>
          )}
        </div>
        <p className="muted">
          {live.status === 'off' ? (
            <>
              Run the iRacing helper on this PC and connect it, then start recording. Every lap you drive is saved with this plan, including the
              laps already driven in this session.{' '}
              <button className="btn tiny" onClick={live.enable}>
                Connect to iRacing
              </button>
            </>
          ) : live.status === 'live' ? (
            <>
              Connected{s?.track ? ` at ${s.track}` : ''}
              {s?.driverName ? `, ${displayName(s.driverName, plan.drivers)} driving` : ''}
              {s ? `, lap ${s.lapsCompleted}` : ''}
              {s?.lastLapTime ? `, last lap ${lapTime(s.lastLapTime)}` : ''}
              {s?.onPitRoad ? ' (in the pits)' : ''}.{' '}
              {recording ? 'Laps are being saved to this plan.' : 'Start recording to save laps to this plan.'}
            </>
          ) : live.status === 'waiting' ? (
            'Helper running, waiting for iRacing.'
          ) : (
            'Looking for the helper on this PC…'
          )}
        </p>
        <p className="muted small">
          Averages use clean laps only: in and out laps, laps with a caution and outliers (spins, traffic, a lap far off your median) are left out.
          Click a lap to leave it out or bring it back.
        </p>
        {applied && (
          <p className="toast" role="status">
            {applied}
          </p>
        )}
      </section>

      <section className="stats">
        <Stat label="Clean laps" value={`${all.clean}`} sub={`of ${all.laps} recorded`} />
        <Stat label="Average lap" value={all.avgLap ? lapTime(all.avgLap) : '–'} sub="clean laps, outliers out" />
        <Stat label="Median lap" value={all.medianLap ? lapTime(all.medianLap) : '–'} sub={all.bestLap ? `best ${lapTime(all.bestLap)}` : ''} />
        <Stat
          label="Incidents"
          value={all.incidents != null ? `${all.incidents}x` : '–'}
          sub={
            all.incidents == null
              ? 'needs the updated helper'
              : all.incidents
                ? `${(all.incidentLaps / all.incidents).toFixed(1)} laps per incident point`
                : `clean over ${all.incidentLaps} laps`
          }
        />
        <Stat label="Fuel per lap" value={fuel ? `${fuel.toFixed(2)} L` : '–'} sub={all.medianFuel ? `median ${all.medianFuel.toFixed(2)} L · ${all.fuelLaps} laps` : 'needs the driving PC'} />
      </section>

      {!readOnly && laps.length > 0 && (
        <section className="panel">
          <h2>Use in the plan</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{team ? 'Driver' : 'Pace'}</th>
                  <th className="num">Clean laps</th>
                  <th className="num">Average</th>
                  <th className="num">Median</th>
                  <th className="num">In the plan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(team ? groups : [{ key: 'all', name: 'All laps', driver: undefined, laps }]).map((g) => {
                  const sum = team ? summarize(g.laps) : all;
                  return (
                    <PaceRow
                      key={g.key}
                      name={g.name}
                      clean={sum.clean}
                      avg={sum.avgLap}
                      med={sum.medianLap}
                      plan={plan}
                      matched={g.driver?.id}
                      current={team ? undefined : plan.baseLapTime}
                      onApply={(t, driverId) => {
                        update((p) => applyPace(p, t, driverId));
                        const who = team ? plan.drivers.find((d) => d.id === driverId)?.name : null;
                        done(`${lapTime(roundLap(t))} set as ${who ? `${who}'s lap time` : 'the plan lap time'}.`);
                      }}
                    />
                  );
                })}
                <tr>
                  <td>Fuel per lap</td>
                  <td className="num">{all.fuelLaps}</td>
                  <td className="num">{all.avgFuel ? `${all.avgFuel.toFixed(2)} L` : '–'}</td>
                  <td className="num">{all.medianFuel ? `${all.medianFuel.toFixed(2)} L` : '–'}</td>
                  <td className="num">{plan.fuel.perLapL.toFixed(2)} L</td>
                  <td>
                    {all.avgFuel != null && (
                      <button
                        className="btn tiny"
                        onClick={() => (update((p) => applyFuel(p, all.avgFuel!)), done(`${roundFuel(all.avgFuel!).toFixed(2)} L per lap set in the plan.`))}
                      >
                        Use average
                      </button>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {team && <p className="muted small">Plan average pace now {lapTime(planPace)}.</p>}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Pit stops</h2>
          {!readOnly && canApply && (
            <button
              className="btn tiny"
              onClick={() => {
                update((p) => setPitTimes(p, measured));
                const parts = [
                  measured.fillRate != null && `refuel rate ${measured.fillRate.toFixed(2)} L/s`,
                  measured.laneLossSec != null && `pit lane loss ${measured.laneLossSec.toFixed(1)} s`,
                  measured.tireSec != null && `tyres ${Math.round(measured.tireSec)} s`,
                ].filter(Boolean);
                done(`Set ${parts.join(', ')} in Race setup.`);
              }}
            >
              Use in the plan
            </button>
          )}
        </div>
        <p className="muted small">
          Make practice stops while recording. Each stop is timed on pit road with the fuel added; the time lost is your in-lap and out-lap against your
          median clean lap. Tick the stops where you changed tyres.
        </p>
        <section className="stats">
          <Stat label="Fill rate" value={pit.fillRate ? `${pit.fillRate.toFixed(2)} L/s` : '–'} sub={pit.fillRate ? `${Math.round(plan.fuel.tankL / pit.fillRate)} s for a ${plan.fuel.tankL} L tank` : 'stop for fuel on the driving PC'} />
          <Stat label="Pit lane loss" value={pit.laneLossSec != null ? `${pit.laneLossSec.toFixed(1)} s` : '–'} sub="driving through, without fuel or tyres" />
          <Stat label="Tyres add" value={pit.tireSec != null ? `${pit.tireSec.toFixed(1)} s` : '–'} sub={pit.tireSec != null ? 'on top of refuelling' : 'needs a stop with tyres ticked'} />
          <Stat
            label="Plan stop time"
            value={`${after.stopSec} s`}
            sub={
              after.stopSec !== plan.pit.stopSec
                ? `now ${plan.pit.stopSec} s · lane loss plus a full tank`
                : after.laneLossSec && after.fillRate
                  ? 'lane loss plus a full tank'
                  : 'add the pit lane loss to work it out'
            }
          />
        </section>
        {stops.length === 0 ? (
          <p className="muted">No stops yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table practice-laps">
              <thead>
                <tr>
                  <th className="num">Lap</th>
                  {team && <th>Driver</th>}
                  <th className="num">Pit road</th>
                  <th className="num">Fuel added</th>
                  <th className="num">Fill rate</th>
                  <th className="num">Time lost</th>
                  <th>Tyres</th>
                  <th>Counts?</th>
                </tr>
              </thead>
              <tbody>
                {[...stops].reverse().map((st) => {
                  const c = pit.perStop.get(st.id)!;
                  const set = (patch: Partial<typeof st>) => setPractice((p) => ({ ...p, stops: p.stops.map((x) => (x.id === st.id ? { ...x, ...patch } : x)) }));
                  return (
                    <tr key={st.id} className={st.excluded ? 'lap-excluded' : 'lap-clean'}>
                      <td className="num">{st.lap}</td>
                      {team && <td>{displayName(st.driver, plan.drivers) || '–'}</td>}
                      <td className="num mono">{st.pitRoadSec.toFixed(1)} s</td>
                      <td className="num mono">{st.fuelAdded ? `${st.fuelAdded.toFixed(1)} L` : '–'}</td>
                      <td className="num mono">{c.fillRate ? `${c.fillRate.toFixed(2)} L/s` : '–'}</td>
                      <td className="num mono" title={c.lossSec == null ? 'Needs the in-lap and out-lap times and some clean laps' : undefined}>
                        {c.lossSec != null ? `${c.lossSec.toFixed(1)} s` : '–'}
                      </td>
                      <td>
                        <input type="checkbox" aria-label="Tyres changed" checked={st.tires} disabled={readOnly} onChange={(e) => set({ tires: e.target.checked })} />
                      </td>
                      <td>
                        <button className="btn tiny lap-toggle" disabled={readOnly} onClick={() => set({ excluded: !st.excluded })}>
                          {st.excluded ? 'Left out' : 'Counts'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!readOnly && stops.length > 0 && (
          <button className="btn tiny" onClick={() => setPractice((p) => ({ ...p, stops: [] }))}>
            Clear stops
          </button>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Laps</h2>
          {!readOnly && laps.length > 0 &&
            (confirmClear ? (
              <span>
                <button className="btn tiny danger" onClick={() => (setPractice((p) => ({ ...p, laps: [] })), setConfirmClear(false))}>
                  Yes, delete all {laps.length} laps
                </button>
                <button className="btn tiny" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="btn tiny" onClick={() => setConfirmClear(true)}>
                Clear laps
              </button>
            ))}
        </div>
        {laps.length === 0 ? (
          <p className="muted">No laps yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table practice-laps">
              <thead>
                <tr>
                  <th className="num">Lap</th>
                  {team && <th>Driver</th>}
                  <th className="num">Time</th>
                  <th className="num">Fuel</th>
                  <th className="num">Inc</th>
                  <th>Counts?</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {[...laps].reverse().map((l) => {
                  const st = all.status.get(l.id) ?? 'clean';
                  return (
                    <tr key={l.id} className={`lap-${st}`}>
                      <td className="num">{l.lap}</td>
                      {team && <td>{displayName(l.driver, plan.drivers) || '–'}</td>}
                      <td className="num mono">{l.lapTime ? lapTime(l.lapTime) : '–'}</td>
                      <td className={`num mono${all.fuelOutliers.has(l.id) ? ' fuel-out' : ''}`} title={all.fuelOutliers.has(l.id) ? 'Fuel use far off the others, left out of the fuel average' : undefined}>
                        {l.fuelUsed ? `${l.fuelUsed.toFixed(2)} L` : '–'}
                      </td>
                      <td className={`num mono${l.incidents ? ' lap-inc' : ''}`}>{l.incidents == null ? '–' : `${l.incidents}x`}</td>
                      <td>
                        <button
                          className="btn tiny lap-toggle"
                          disabled={readOnly}
                          title={l.excluded ? 'Bring this lap back into the averages' : 'Leave this lap out of the averages'}
                          onClick={() =>
                            setPractice((p) => ({ ...p, laps: p.laps.map((x) => (x.id === l.id ? { ...x, excluded: !x.excluded } : x)) }))
                          }
                        >
                          {STATUS_LABEL[st]}
                        </button>
                      </td>
                      <td className="muted">{new Date(l.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PaceRow(props: {
  name: string;
  clean: number;
  avg: number | null;
  med: number | null;
  plan: Plan;
  matched?: string;
  current?: number;
  onApply: (t: number, driverId?: string) => void;
}) {
  const team = props.plan.mode === 'team';
  const [target, setTarget] = useState(props.matched ?? props.plan.drivers[0]?.id ?? '');
  const now = team ? props.plan.drivers.find((d) => d.id === target)?.lapTime : props.current;
  return (
    <tr>
      <td>{props.name}</td>
      <td className="num">{props.clean}</td>
      <td className="num mono">{props.avg ? lapTime(props.avg) : '–'}</td>
      <td className="num mono">{props.med ? lapTime(props.med) : '–'}</td>
      <td className="num mono">{now ? lapTime(now) : '–'}</td>
      <td>
        {props.avg != null && (
          <span className="practice-apply">
            <button className="btn tiny" onClick={() => props.onApply(props.avg!, team ? target : undefined)}>
              Use average{team ? ' for' : ''}
            </button>
            {team && (
              <Select
                id={`apply-${props.name}`}
                value={target}
                onChange={setTarget}
                options={props.plan.drivers.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

function Stat(props: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-sub">{props.sub}</div>
    </div>
  );
}
