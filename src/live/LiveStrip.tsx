// The live strip on top of the Stints tab: link status and what the car is doing now.
import { raceWindow } from '../engine';
import type { Plan } from '../model';
import { duration, lapTime } from '../time';
import { inRaceWindow } from './apply';
import { displayName } from './names';
import type { Live } from './useLive';
import './live.css';

export function LiveStrip({ live, readOnly, plan }: { live: Live; readOnly: boolean; plan: Plan }) {
  const { status, state: s } = live;
  if (status === 'off') {
    return (
      <div className="live-strip is-off">
        <span className="live-dot" aria-hidden />
        <span>
          Driving? Run the iRacing helper on this PC and the actual end and laps of each stint fill in by themselves.
        </span>
        <button className="btn small" onClick={live.enable}>
          Connect to iRacing
        </button>
      </div>
    );
  }
  const lapsLeft = s?.fuelLevel != null && s.fuelPerLap ? s.fuelLevel / s.fuelPerLap : null;
  const label =
    status === 'live' ? (live.source === 'demo' ? 'Live (demo race)' : 'Live') : status === 'waiting' ? 'Helper running, waiting for iRacing' : 'Looking for the helper on this PC…';
  return (
    <div className={`live-strip is-${status}`} role="status" aria-live="polite">
      <span className="live-dot" aria-hidden />
      <strong className="live-label">{label}</strong>
      {status === 'live' && s && (
        <dl className="live-values">
          {s.caution && <span className="live-flag">Caution</span>}
          {s.onPitRoad && <span className="live-flag pit">In pits</span>}
          {s.driverName && <Item k="Driver" v={displayName(s.driverName, plan.drivers)} />}
          <Item k="Lap" v={String(s.lapsCompleted)} />
          <Item k="Last lap" v={s.lastLapTime ? lapTime(s.lastLapTime) : '–'} mono />
          <Item k="Avg" v={s.avgLapTime ? lapTime(s.avgLapTime) : '–'} mono />
          {s.fuelLevel != null && <Item k="Fuel" v={`${s.fuelLevel.toFixed(1)} L`} mono />}
          {s.fuelPerLap != null && <Item k="Per lap" v={`${s.fuelPerLap.toFixed(2)} L`} mono />}
          {lapsLeft != null && <Item k="Fuel for" v={`${lapsLeft.toFixed(1)} laps`} mono />}
          {s.sessionTimeRemain != null && <Item k="Race left" v={duration(s.sessionTimeRemain)} mono />}
        </dl>
      )}
      {status === 'live' && s && !s.isRace && <span className="muted">Stints fill in during the race session only.</span>}
      {status === 'live' && !inRaceWindow(plan, Date.now()) && (
        <span className="muted">
          Stops don't fill in this plan: its race is on {raceDay(plan)}, not now.
          {live.source === 'demo' && ' To try the demo, pick “Demo race, starting now” from the plan menu at the top.'}
        </span>
      )}
      {readOnly && status === 'live' && <span className="muted">View only: ask the owner for edit access to fill stints.</span>}
      {live.filled > 0 && <span className="muted">{live.filled} stint{live.filled > 1 ? 's' : ''} filled in</span>}
      <button className="btn tiny" onClick={live.disable}>
        Disconnect
      </button>
    </div>
  );
}

const Item = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="live-item">
    <dt>{k}</dt>
    <dd className={mono ? 'mono' : ''}>{v}</dd>
  </div>
);

const raceDay = (plan: Plan) =>
  new Date(raceWindow(plan).raceStart).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
