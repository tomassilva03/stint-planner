import { newDriver, type Plan } from '../model';
import { lapTime, parseLapTime } from '../time';
import { Field, NumberField } from '../ui';
import type { ViewProps } from './Overview';

export function Drivers({ plan, update, calc }: ViewProps) {
  const set = (fn: (p: Plan) => void) =>
    update((p) => {
      const copy = structuredClone(p);
      fn(copy);
      return copy;
    });
  const rated = plan.drivers.filter((d) => d.iRating > 0);
  const avgIr = rated.length ? Math.round(rated.reduce((n, d) => n + d.iRating, 0) / rated.length) : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Roster</h2>
        <span className="muted">
          {plan.drivers.length} drivers{avgIr ? ` · average iRating ${avgIr}` : ''} · team lap {lapTime(calc.baseLapTime)}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table edit">
          <thead>
            <tr>
              <th>Colour</th>
              <th>Name</th>
              <th>Time zone (UTC±h)</th>
              <th>iRating</th>
              <th>Lap time</th>
              <th>Max stints in a row</th>
              <th className="num">Pace vs team</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.drivers.map((d, i) => (
              <tr key={d.id}>
                <td>
                  <input id={`drv-color-${d.id}`} aria-label={`${d.name} colour`} type="color" className="color" value={d.color} onChange={(e) => set((p) => void (p.drivers[i].color = e.target.value))} />
                </td>
                <td>
                  <Field id={`drv-name-${d.id}`} ariaLabel="Name" className="input" value={d.name} onCommit={(v) => set((p) => void (p.drivers[i].name = v))} />
                </td>
                <td>
                  <NumberField id={`drv-tz-${d.id}`} ariaLabel="UTC offset in hours" className="input short" value={d.utcOffset} onCommit={(v) => set((p) => void (p.drivers[i].utcOffset = v))} />
                </td>
                <td>
                  <NumberField id={`drv-ir-${d.id}`} ariaLabel="iRating" className="input short" value={d.iRating} min={0} onCommit={(v) => set((p) => void (p.drivers[i].iRating = v))} />
                </td>
                <td>
                  <Field
                    id={`drv-lap-${d.id}`}
                    ariaLabel="Lap time"
                    className="input short mono"
                    value={lapTime(d.lapTime)}
                    placeholder="2:06.000"
                    onCommit={(v) => set((p) => void (p.drivers[i].lapTime = parseLapTime(v) ?? 0))}
                  />
                </td>
                <td>
                  <NumberField id={`drv-max-${d.id}`} ariaLabel="Max stints in a row" className="input short" value={d.maxConsecutive} min={1} onCommit={(v) => set((p) => void (p.drivers[i].maxConsecutive = Math.round(v)))} />
                </td>
                <td className="num mono">{d.lapTime > 0 ? `${((d.lapTime / calc.baseLapTime - 1) * 100).toFixed(1)}%` : '–'}</td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${d.name}`}
                    disabled={plan.drivers.length <= 1}
                    onClick={() =>
                      set((p) => {
                        p.drivers.splice(i, 1);
                        delete p.availability[d.id];
                        p.stints.forEach((s) => s.driverId === d.id && (s.driverId = null));
                      })
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn small" onClick={() => set((p) => void p.drivers.push(newDriver(p.drivers.length)))}>
        Add driver
      </button>
      <p className="hint">Each driver's lap time sets their pace factor against the team average, so a slower driver's stints run longer.</p>
    </section>
  );
}
