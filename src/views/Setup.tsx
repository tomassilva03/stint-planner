import { lapsPerStint } from '../engine';
import { setPitTimes, stopSecFrom, uid, type Plan } from '../model';
import { duration, inputUtcToIso, isoToInputUtc, lapTime, parseHm, parseLapTime } from '../time';
import { Field, Labeled, NumberField } from '../ui';
import type { ViewProps } from './Overview';

export function Setup({ plan, update, calc }: ViewProps) {
  const set = (fn: (p: Plan) => void) =>
    update((p) => {
      const copy = structuredClone(p);
      fn(copy);
      return copy;
    });
  const hm = (min: number) => duration(min * 60, false);

  return (
    <div className="stack">
      <section className="panel">
        <h2>Event</h2>
        <div className="form-grid">
          <Labeled label="Track" htmlFor="ev-track">
            <Field id="ev-track" className="input" value={plan.event.track} placeholder="e.g. Spa-Francorchamps" onCommit={(v) => set((p) => void (p.event.track = v))} />
          </Labeled>
          <Labeled label="Car" htmlFor="ev-car">
            <Field id="ev-car" className="input" value={plan.event.car} placeholder="e.g. Porsche 911 GT3 R" onCommit={(v) => set((p) => void (p.event.car = v))} />
          </Labeled>
          <Labeled label="Session start (GMT)" htmlFor="ev-start" hint="When the session opens, as listed by iRacing.">
            <input
              id="ev-start"
              className="input"
              type="datetime-local"
              value={isoToInputUtc(plan.event.sessionStart)}
              onChange={(e) => e.target.value && set((p) => void (p.event.sessionStart = inputUtcToIso(e.target.value)))}
            />
          </Labeled>
          <Labeled label="Green flag after" htmlFor="ev-offset" unit="min" hint="Qualifying, grid and formation lap before the race clock starts.">
            <NumberField id="ev-offset" className="input" value={plan.event.greenFlagOffsetMin} min={0} onCommit={(v) => set((p) => void (p.event.greenFlagOffsetMin = v))} />
          </Labeled>
          <Labeled label="Race length" htmlFor="ev-duration" unit="h:mm">
            <Field
              id="ev-duration"
              className="input"
              value={hm(plan.event.durationMin)}
              onCommit={(v) => {
                const m = parseHm(v);
                if (m && m > 0) set((p) => void (p.event.durationMin = m));
              }}
            />
          </Labeled>
          <Labeled label="In-sim time at green" htmlFor="ev-sim" hint="Drives the time-of-day pace factors below.">
            <input id="ev-sim" className="input" type="time" value={plan.event.simStart} onChange={(e) => e.target.value && set((p) => void (p.event.simStart = e.target.value))} />
          </Labeled>
        </div>
      </section>

      <section className="panel">
        <h2>Fuel and pace</h2>
        <div className="form-grid">
          <Labeled label="Fuel tank" htmlFor="fu-tank" unit="L" hint="Usable fuel, after any BoP fuel limit.">
            <NumberField id="fu-tank" className="input" value={plan.fuel.tankL} min={0} onCommit={(v) => update((p) => setPitTimes({ ...p, fuel: { ...p.fuel, tankL: v } }, {}))} />
          </Labeled>
          <Labeled label="Fuel per lap" htmlFor="fu-lap" unit="L">
            <NumberField id="fu-lap" className="input" value={plan.fuel.perLapL} min={0} onCommit={(v) => set((p) => void (p.fuel.perLapL = v))} />
          </Labeled>
          <Labeled
            label={plan.mode === 'solo' ? 'Lap time' : 'Fallback lap time'}
            htmlFor="fu-laptime"
            hint={plan.mode === 'solo' ? 'Your typical race pace.' : 'Used only when no driver has a lap time set.'}
          >
            <Field
              id="fu-laptime"
              className="input"
              value={lapTime(plan.baseLapTime)}
              placeholder="2:06.000"
              onCommit={(v) => {
                const s = parseLapTime(v);
                if (s) set((p) => void (p.baseLapTime = s));
              }}
            />
          </Labeled>
          <Labeled label="Fuel saving: slower by" htmlFor="fu-slap" unit="%">
            <NumberField id="fu-slap" className="input" digits={2} value={(plan.fuel.saveLapFactor - 1) * 100} onCommit={(v) => set((p) => void (p.fuel.saveLapFactor = 1 + v / 100))} />
          </Labeled>
          <Labeled label="Fuel saving: uses less fuel by" htmlFor="fu-sfuel" unit="%">
            <NumberField id="fu-sfuel" className="input" digits={2} value={(1 - plan.fuel.saveFuelFactor) * 100} onCommit={(v) => set((p) => void (p.fuel.saveFuelFactor = 1 - v / 100))} />
          </Labeled>
          <div className="labeled readout">
            <span className="readout-label">Laps per tank</span>
            <span className="readout-value">
              {lapsPerStint(plan, 'standard')} <span className="muted">standard</span> · {lapsPerStint(plan, 'save')} <span className="muted">saving</span>
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Pit stops</h2>
        <div className="form-grid">
          <Labeled label="Pit lane loss" htmlFor="pit-lane" unit="s" hint="Driving through pit lane without stopping. Measured on the Practice tab.">
            <NumberField id="pit-lane" className="input" value={plan.pit.laneLossSec ?? 0} min={0} onCommit={(v) => update((p) => setPitTimes(p, { laneLossSec: v }))} />
          </Labeled>
          <Labeled label="Refuel rate" htmlFor="pit-fill" unit="L/s" hint={plan.pit.fillRate ? `A full ${plan.fuel.tankL} L tank takes ${Math.round(plan.fuel.tankL / plan.pit.fillRate)} s.` : 'Measured on the Practice tab.'}>
            <NumberField id="pit-fill" className="input" value={plan.pit.fillRate ?? 0} min={0} digits={2} onCommit={(v) => update((p) => setPitTimes(p, { fillRate: v }))} />
          </Labeled>
          <Labeled
            label="Stop without tyres"
            htmlFor="pit-stop"
            unit="s"
            hint={stopSecFrom(plan.pit, plan.fuel.tankL) != null ? 'Pit lane loss plus a full refuel, from the two fields before.' : 'Pit lane loss plus a full refuel. Fill in both fields before to work it out.'}
          >
            {stopSecFrom(plan.pit, plan.fuel.tankL) != null ? (
              <output id="pit-stop" className="readout-value">{plan.pit.stopSec}</output>
            ) : (
              <NumberField id="pit-stop" className="input" value={plan.pit.stopSec} min={0} onCommit={(v) => set((p) => void (p.pit.stopSec = v))} />
            )}
          </Labeled>
          <Labeled label="Extra for four tyres" htmlFor="pit-tyre" unit="s">
            <NumberField id="pit-tyre" className="input" value={plan.pit.tireSec} min={0} onCommit={(v) => set((p) => void (p.pit.tireSec = v))} />
          </Labeled>
          <div className="labeled">
            <span className="readout-label">New stints</span>
            <label className="check">
              <input type="checkbox" id="pit-tyredefault" checked={plan.pit.tiresByDefault} onChange={(e) => set((p) => void (p.pit.tiresByDefault = e.target.checked))} />
              Change tyres by default
            </label>
            <button
              className="btn small"
              onClick={() => set((p) => p.stints.forEach((s) => (s.tires = p.pit.tiresByDefault)))}
            >
              Apply to every stint
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Time-of-day pace</h2>
        <p className="hint">Each stint uses the factor for the in-sim time when it starts. 0.99 means 1% faster (cooler track).</p>
        <div className="table-wrap">
          <table className="table edit">
            <thead>
              <tr>
                <th>Period</th>
                <th>Starts (sim)</th>
                <th>Factor</th>
                <th className="num">Lap time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.todPeriods.map((t, i) => (
                <tr key={t.id}>
                  <td>
                    <Field id={`tod-label-${t.id}`} ariaLabel="Period name" className="input" value={t.label} onCommit={(v) => set((p) => void (p.todPeriods[i].label = v))} />
                  </td>
                  <td>
                    <input id={`tod-start-${t.id}`} aria-label="Starts at" className="input" type="time" value={t.start} onChange={(e) => e.target.value && set((p) => void (p.todPeriods[i].start = e.target.value))} />
                  </td>
                  <td>
                    <NumberField id={`tod-factor-${t.id}`} ariaLabel="Lap time factor" className="input short" value={t.factor} min={0.5} onCommit={(v) => set((p) => void (p.todPeriods[i].factor = v))} />
                  </td>
                  <td className="num mono">{lapTime(calc.baseLapTime * t.factor)}</td>
                  <td>
                    <button className="icon-btn" aria-label={`Remove ${t.label}`} onClick={() => set((p) => void p.todPeriods.splice(i, 1))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn small" onClick={() => set((p) => void p.todPeriods.push({ id: uid(), label: 'New period', start: '12:00', factor: 1 }))}>
          Add period
        </button>
      </section>

      <section className="panel">
        <h2>Safety car laps</h2>
        <p className="hint">Used when you enter safety car laps on a stint during the race (any event type). They are slower and burn less fuel, so the stint runs longer.</p>
        <div className="form-grid">
              <Labeled label="Safety car lap slower by" htmlFor="sc-pace" unit="%">
                <NumberField id="sc-pace" className="input" digits={1} value={(plan.rules.safetyCar.lapTimeFactor - 1) * 100} min={0} onCommit={(v) => set((p) => void (p.rules.safetyCar.lapTimeFactor = 1 + v / 100))} />
              </Labeled>
              <Labeled label="Fuel per safety car lap" htmlFor="sc-fuel" unit="% of green">
                <NumberField id="sc-fuel" className="input" digits={1} value={plan.rules.safetyCar.fuelFactor * 100} min={0} onCommit={(v) => set((p) => void (p.rules.safetyCar.fuelFactor = v / 100))} />
              </Labeled>
              <Labeled label="Stop under safety car" htmlFor="sc-pit" unit="s" hint="Time lost pitting while the field is slow.">
                <NumberField id="sc-pit" className="input" value={plan.rules.safetyCar.pitSec} min={0} onCommit={(v) => set((p) => void (p.rules.safetyCar.pitSec = v))} />
              </Labeled>
        </div>
      </section>

      <LeagueRules plan={plan} set={set} />
    </div>
  );
}

function LeagueRules({ plan, set }: { plan: Plan; set: (fn: (p: Plan) => void) => void }) {
  if (plan.eventKind === 'special') {
    return (
      <section className="panel muted-panel">
        <h2>League rules</h2>
        <p className="hint">
          iRacing special events have no safety cars or tyre limits. Switch this plan to League at the top to plan safety cars, a tyre set limit, driver time
          limits and a minimum number of stops.
        </p>
      </section>
    );
  }
  const r = plan.rules;
  return (
    <section className="panel">
      <h2>League rules</h2>
      <div className="rules">
        <div className="rule">
          <label className="check rule-head">
            <input type="checkbox" id="rule-sc" checked={r.safetyCar.enabled} onChange={(e) => set((p) => void (p.rules.safetyCar.enabled = e.target.checked))} />
            Safety cars
          </label>
          <p className="hint">Plan for safety cars before the race. The Stints tab can spread them evenly over the race; their pace and fuel use come from Safety car laps above.</p>
          {r.safetyCar.enabled && (
            <div className="form-grid">
              <Labeled label="Expected safety cars" htmlFor="sc-count">
                <NumberField id="sc-count" className="input" value={r.safetyCar.expectedCount} min={0} onCommit={(v) => set((p) => void (p.rules.safetyCar.expectedCount = Math.round(v)))} />
              </Labeled>
              <Labeled label="Laps per safety car" htmlFor="sc-laps">
                <NumberField id="sc-laps" className="input" value={r.safetyCar.avgLaps} min={0} onCommit={(v) => set((p) => void (p.rules.safetyCar.avgLaps = Math.round(v)))} />
              </Labeled>
            </div>
          )}
        </div>
        <div className="rule">
          <label className="check rule-head">
            <input type="checkbox" id="rule-tyres" checked={r.tyreSets.enabled} onChange={(e) => set((p) => void (p.rules.tyreSets.enabled = e.target.checked))} />
            Tyre set limit
          </label>
          <p className="hint">Each stop with tyres ticked fits a new set. The plan warns from the stint where you would run out.</p>
          {r.tyreSets.enabled && (
            <div className="form-grid">
              <Labeled label="Sets allowed" htmlFor="ty-sets">
                <NumberField id="ty-sets" className="input" value={r.tyreSets.setsAvailable} min={1} onCommit={(v) => set((p) => void (p.rules.tyreSets.setsAvailable = Math.round(v)))} />
              </Labeled>
              <div className="labeled">
                <span className="readout-label">Starting set</span>
                <label className="check">
                  <input type="checkbox" id="ty-start" checked={r.tyreSets.includesStartSet} onChange={(e) => set((p) => void (p.rules.tyreSets.includesStartSet = e.target.checked))} />
                  Counts towards the limit
                </label>
              </div>
            </div>
          )}
        </div>
        {plan.mode === 'team' && (
          <div className="rule">
            <label className="check rule-head">
              <input type="checkbox" id="rule-time" checked={r.driverTime.enabled} onChange={(e) => set((p) => void (p.rules.driverTime.enabled = e.target.checked))} />
              Driver time limits
            </label>
            <p className="hint">Leave a value at 0 to skip it.</p>
            {r.driverTime.enabled && (
              <div className="form-grid">
                <Labeled label="Minimum per driver" htmlFor="dt-min" unit="h:mm">
                  <Field id="dt-min" className="input" value={duration(r.driverTime.minMinutes * 60, false)} onCommit={(v) => { const m = parseHm(v); if (m != null) set((p) => void (p.rules.driverTime.minMinutes = m)); }} />
                </Labeled>
                <Labeled label="Maximum per driver" htmlFor="dt-max" unit="h:mm">
                  <Field id="dt-max" className="input" value={duration(r.driverTime.maxMinutes * 60, false)} onCommit={(v) => { const m = parseHm(v); if (m != null) set((p) => void (p.rules.driverTime.maxMinutes = m)); }} />
                </Labeled>
                <Labeled label="Maximum in one go" htmlFor="dt-stint" unit="h:mm" hint="Back-to-back stints count as one spell in the car.">
                  <Field id="dt-stint" className="input" value={duration(r.driverTime.maxStintMinutes * 60, false)} onCommit={(v) => { const m = parseHm(v); if (m != null) set((p) => void (p.rules.driverTime.maxStintMinutes = m)); }} />
                </Labeled>
              </div>
            )}
          </div>
        )}
        <div className="rule">
          <label className="check rule-head">
            <input type="checkbox" id="rule-stops" checked={r.minPitStops.enabled} onChange={(e) => set((p) => void (p.rules.minPitStops.enabled = e.target.checked))} />
            Minimum pit stops
          </label>
          {r.minPitStops.enabled && (
            <div className="form-grid">
              <Labeled label="Stops required" htmlFor="ms-count">
                <NumberField id="ms-count" className="input" value={r.minPitStops.count} min={0} onCommit={(v) => set((p) => void (p.rules.minPitStops.count = Math.round(v)))} />
              </Labeled>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
