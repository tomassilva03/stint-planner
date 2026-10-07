import { Fragment, useState } from 'react';
import { autoAssign, blankStint, spreadSafetyCars, type StintCalc } from '../engine';
import type { Plan, StintType } from '../model';
import { clock, dateLabel, delta, duration, lapTime, parseClockNear, parseDurationText, shortDuration, simClock } from '../time';
import { AVAIL_LABEL, Field, NumberField, Pill, Select } from '../ui';
import { LiveStrip } from '../live/LiveStrip';
import type { Live } from '../live/useLive';
import type { ViewProps } from './Overview';

export function Stints({ plan, calc, update, tz, tzName, now, live, readOnly }: ViewProps & { live?: Live; readOnly?: boolean }) {
  const set = (fn: (p: Plan) => void) =>
    update((p) => {
      const copy = structuredClone(p);
      fn(copy);
      return copy;
    });
  const team = plan.mode === 'team';
  const league = plan.eventKind === 'league';
  const scOn = league && plan.rules.safetyCar.enabled;
  const [open, setOpen] = useState<string | null>(null);
  const tyreOn = league && plan.rules.tyreSets.enabled;
  const drivers = plan.drivers.filter((d) => d.name.trim());
  let lastDay = '';

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Stint plan</h2>
        <span className="muted">Times in {tzName}</span>
      </div>
      {live && <LiveStrip live={live} readOnly={!!readOnly} drivers={plan.drivers} />}
      <div className="toolbar">
        {team && (
          <>
            <button className="btn primary small" onClick={() => update(autoAssign)}>
              Auto-assign empty stints
            </button>
            <button className="btn small" onClick={() => set((p) => p.stints.forEach((s) => !s.actualEnd && (s.driverId = null)))}>
              Clear unfinished drivers
            </button>
          </>
        )}
        {scOn && (
          <>
            <button className="btn small" onClick={() => update(spreadSafetyCars)} title={`Adds ${plan.rules.safetyCar.expectedCount} safety cars of ${plan.rules.safetyCar.avgLaps} laps, evenly spread`}>
              Spread expected safety cars
            </button>
            <button className="btn small" onClick={() => set((p) => p.stints.forEach((s) => !s.actualEnd && ((s.scLaps = 0), (s.pitUnderSc = false))))}>
              Clear planned safety cars
            </button>
          </>
        )}
        <button className="btn small" onClick={() => set((p) => p.stints.forEach((s) => (s.actualEnd = undefined, s.actualLaps = undefined, s.liveId = undefined, s.lapsAtEnd = undefined)))}>
          Clear live times
        </button>
      </div>
      <div className="table-wrap">
        <table className="table stints">
          <thead>
            <tr>
              <th className="num">#</th>
              {team && <th>Driver</th>}
              <th>Pace</th>
              <th>Tyres</th>
              <th>Start</th>
              <th>Pit in</th>
              <th>Expected end</th>
              <th>Actual end</th>
              <th className="num">vs plan</th>
              <th className="num">Laps</th>
              <th className="num">Lap</th>
              <th className="num">Fuel in</th>
              <th>Sim time</th>
              {team && <th>Availability</th>}
              <th>Race events</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {calc.stints.map((s, i) => {
              const day = dateLabel(s.start, tz(s.start));
              const newDay = day !== lastDay;
              lastDay = day;
              const isNow = now >= s.start && now < s.end && !s.isSurplus;
              const cls = [s.isSurplus ? 'surplus' : '', isNow ? 'now' : '', s.stint.actualEnd ? 'done' : '', newDay ? 'day-start' : ''].join(' ');
              const localOff = s.driver ? s.driver.utcOffset * 60 : null;
              return (
                <Fragment key={s.stint.id}>
                <tr className={cls}>
                  <td className="num">
                    <span className="stint-num" style={{ borderColor: s.driver?.color ?? 'var(--line)' }}>
                      {s.index}
                    </span>
                  </td>
                  {team && (
                    <td>
                      <Select
                        id={`st-driver-${s.stint.id}`}
                        ariaLabel={`Driver for stint ${s.index}`}
                        className={`input ${s.stint.driverId ? '' : 'needs'}`}
                        value={s.stint.driverId ?? ''}
                        onChange={(v) => set((p) => void (p.stints[i].driverId = v || null))}
                        options={[{ value: '', label: 'Select driver' }, ...drivers.map((d) => ({ value: d.id, label: d.name }))]}
                      />
                    </td>
                  )}
                  <td>
                    <Select<StintType>
                      id={`st-type-${s.stint.id}`}
                      ariaLabel={`Pace for stint ${s.index}`}
                      className="input"
                      value={s.stint.type}
                      onChange={(v) => set((p) => void (p.stints[i].type = v))}
                      options={[
                        { value: 'standard', label: 'Standard' },
                        { value: 'save', label: 'Fuel save' },
                      ]}
                    />
                  </td>
                  <td>
                    {!s.isFinal && (
                      <input
                        id={`st-tyres-${s.stint.id}`}
                        type="checkbox"
                        aria-label={`Change tyres after stint ${s.index}`}
                        checked={s.stint.tires}
                        onChange={(e) => set((p) => void (p.stints[i].tires = e.target.checked))}
                      />
                    )}
                    {tyreOn && !s.isSurplus && (
                      <span className={`tyre-set ${s.tyreOver ? 'over' : ''}`} title={s.tyreOver ? 'Beyond the tyre set limit' : 'Tyre set this stint runs on'}>
                        set {s.tyreSet}
                      </span>
                    )}
                  </td>
                  <td className="mono nowrap">
                    {newDay && <span className="day">{day}</span>}
                    {clock(s.start, tz(s.start))}
                    {team && localOff != null && <span className="local">local {clock(s.start, localOff)}</span>}
                  </td>
                  <td className="mono nowrap">
                    {s.isFinal ? (
                      <span title="Checkered flag">
                        <span className="flag-tag">Flag</span> {clock(s.pitIn, tz(s.pitIn))}
                      </span>
                    ) : (
                      <>
                        {clock(s.pitIn, tz(s.pitIn))}
                        <span className="local">{duration((s.pitIn - s.start) / 1000, false)} on track</span>
                      </>
                    )}
                  </td>
                  <td className="mono nowrap expected">
                    {s.isSurplus ? '' : clock(s.plannedEnd, tz(s.plannedEnd), true)}
                    {!s.isSurplus && !s.isFinal && <span className="local">after a {Math.round(s.pitSec)} s stop</span>}
                  </td>
                  <td>
                    <div className="actual">
                      <Field
                        id={`st-actual-${s.stint.id}`}
                        ariaLabel={`Actual end of stint ${s.index}`}
                        className="input short mono"
                        placeholder="hh:mm:ss"
                        value={s.stint.actualEnd ? clock(Date.parse(s.stint.actualEnd), tz(Date.parse(s.stint.actualEnd)), true) : ''}
                        onCommit={(v) => {
                          if (!v.trim()) return set((p) => void (p.stints[i].actualEnd = undefined));
                          const t = parseClockNear(v, s.plannedEnd, tz(s.plannedEnd));
                          if (t != null) set((p) => void (p.stints[i].actualEnd = new Date(t).toISOString()));
                        }}
                      />
                      {!s.isSurplus && !s.stint.actualEnd && (
                        <button className="btn tiny" title="Set the actual end to now" onClick={() => set((p) => void (p.stints[i].actualEnd = new Date().toISOString()))}>
                          Now
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={`num mono ${s.deltaSec == null ? '' : s.deltaSec > 0 ? 'bad' : 'good'}`}>{s.deltaSec == null ? '' : delta(s.deltaSec)}</td>
                  <td className="num">
                    {s.laps}
                    {s.stint.actualLaps != null && <span className="local">logged</span>}
                  </td>
                  <td className="num mono">{lapTime(s.lapTime)}</td>
                  <td className="num">{s.isSurplus ? '' : `${s.fuelToAdd.toFixed(1)} L`}</td>
                  <td className="nowrap">
                    {simClock(s.simStartMin)} <span className="muted">{s.todLabel}</span>
                  </td>
                  {team && (
                    <td>
                      {!s.isSurplus && s.driver && <Pill tone={s.avail}>{AVAIL_LABEL[s.avail]}</Pill>}
                      {s.overPref && (
                        <Pill tone="warn" title={`Prefers at most ${s.driver?.maxConsecutive} in a row`}>
                          {s.consecutive} in a row
                        </Pill>
                      )}
                      {s.overSeatTime && (
                        <Pill tone="blocked" title="Over the league's maximum time in the car">
                          {duration(s.seatRunMs / 1000, false)} in car
                        </Pill>
                      )}
                    </td>
                  )}
                  <td>
                    <div className="events">
                      <EventChips s={s} />
                      {!s.isSurplus && (
                        <button
                          className={`btn tiny ${open === s.stint.id ? 'on' : ''}`}
                          aria-expanded={open === s.stint.id}
                          aria-controls={`ev-${s.stint.id}`}
                          onClick={() => setOpen(open === s.stint.id ? null : s.stint.id)}
                        >
                          {open === s.stint.id ? 'Close' : 'Log event'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="nowrap">
                    <button className="icon-btn" title="Insert a stint after this one" aria-label={`Insert after stint ${s.index}`} onClick={() => set((p) => void p.stints.splice(i + 1, 0, blankStint(p, p.stints[i])))}>
                      +
                    </button>
                    <button className="icon-btn" title="Remove this stint" aria-label={`Remove stint ${s.index}`} onClick={() => set((p) => void p.stints.splice(i, 1))}>
                      ×
                    </button>
                  </td>
                </tr>
                {open === s.stint.id && (
                  <tr className="event-row" id={`ev-${s.stint.id}`}>
                    <td colSpan={99}>
                      <EventEditor s={s} i={i} set={set} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        During the race, each stint shows when it is expected to end. Use Log event for anything unplanned, such as time lost to a repair, safety car laps or a
        slower pace, and the expected end and every later stint move at once. When the car rejoins the track, type the actual end time (or press Now) and the
        rest of the race recalculates from it.
      </p>
    </section>
  );
}

function EventChips({ s }: { s: StintCalc }) {
  const st = s.stint;
  return (
    <>
      {s.lostSec > 0 && <Pill tone="blocked">+{shortDuration(s.lostSec)} lost</Pill>}
      {s.scLaps > 0 && <Pill tone="tentative">{s.scLaps} SC laps</Pill>}
      {st.pitUnderSc && !s.isFinal && <Pill tone="tentative">Stop under SC</Pill>}
      {st.paceModSec ? <Pill tone="warn">{st.paceModSec > 0 ? '+' : ''}{st.paceModSec} s/lap</Pill> : null}
      {st.note && (
        <span className="note-chip" title={st.note}>
          {st.note}
        </span>
      )}
    </>
  );
}

function EventEditor({ s, i, set }: { s: StintCalc; i: number; set: (fn: (p: Plan) => void) => void }) {
  const st = s.stint;
  const addLost = (sec: number) => set((p) => void (p.stints[i].lostSec = Math.max(0, (p.stints[i].lostSec ?? 0) + sec)));
  return (
    <div className="event-editor">
      <div className="labeled wide">
        <label htmlFor={`ev-lost-${st.id}`}>Time lost (repairs, long stop, penalty)</label>
        <div className="with-unit">
          <Field
            id={`ev-lost-${st.id}`}
            className="input short mono"
            value={st.lostSec ? shortDuration(st.lostSec) : ''}
            placeholder="m:ss"
            onCommit={(v) => {
              const sec = parseDurationText(v);
              if (sec != null) set((p) => void (p.stints[i].lostSec = sec || undefined));
            }}
          />
          <button className="btn tiny" onClick={() => addLost(60)}>+1 min</button>
          <button className="btn tiny" onClick={() => addLost(300)}>+5 min</button>
        </div>
        <p className="hint">Type 10 for ten minutes, or 2:30.</p>
      </div>
      <div className="labeled">
        <label htmlFor={`ev-sc-${st.id}`}>Safety car laps</label>
        <NumberField id={`ev-sc-${st.id}`} className="input short" value={st.scLaps ?? 0} min={0} onCommit={(v) => set((p) => void (p.stints[i].scLaps = Math.round(v) || undefined))} />
        {!s.isFinal && (
          <label className="check">
            <input type="checkbox" id={`ev-scpit-${st.id}`} checked={!!st.pitUnderSc} onChange={(e) => set((p) => void (p.stints[i].pitUnderSc = e.target.checked || undefined))} />
            Stop under the safety car
          </label>
        )}
      </div>
      <div className="labeled">
        <label htmlFor={`ev-pace-${st.id}`}>Slower by (traffic, damage)</label>
        <div className="with-unit">
          <NumberField id={`ev-pace-${st.id}`} className="input short" value={st.paceModSec} onCommit={(v) => set((p) => void (p.stints[i].paceModSec = v))} />
          <span className="unit">s per lap</span>
        </div>
      </div>
      <div className="labeled">
        <label htmlFor={`ev-laps-${st.id}`}>Actual laps</label>
        <NumberField id={`ev-laps-${st.id}`} className="input short" value={st.actualLaps ?? NaN} min={0} onCommit={(v) => set((p) => void (p.stints[i].actualLaps = Math.round(v)))} />
        <p className="hint">For fuel and lap counts. Leave empty to use the plan.</p>
      </div>
      <div className="labeled grow">
        <label htmlFor={`ev-note-${st.id}`}>Note</label>
        <Field id={`ev-note-${st.id}`} className="input" value={st.note ?? ''} placeholder="e.g. Contact in T1, front splitter repaired" onCommit={(v) => set((p) => void (p.stints[i].note = v || undefined))} />
      </div>
    </div>
  );
}
