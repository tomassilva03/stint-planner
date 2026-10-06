import { useEffect, useRef, useState } from 'react';
import { slotsBetween } from '../engine';
import type { Avail, Plan } from '../model';
import { clock, dateLabel, offsetLabel } from '../time';
import { AVAIL_LABEL } from '../ui';
import type { ViewProps } from './Overview';

type Brush = Avail | 'clear';
const BRUSHES: Brush[] = ['open', 'tentative', 'blocked', 'clear'];

export function Availability({ plan, calc, update, tz, tzName }: ViewProps) {
  const [brush, setBrush] = useState<Brush>('blocked');
  const painting = useRef(false);
  useEffect(() => {
    const stop = () => (painting.current = false);
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const drivers = plan.drivers.filter((d) => d.name.trim());
  const slots = slotsBetween(calc.raceStart, calc.raceEnd, plan.slotMin);
  const stintAt = (t: number) => calc.active.find((s) => t + plan.slotMin * 30_000 >= s.start && t + plan.slotMin * 30_000 < s.end);

  const paint = (driverId: string, keys: string[], b: Brush = brush) =>
    update((p: Plan) => {
      const map = { ...(p.availability[driverId] ?? {}) };
      for (const k of keys) {
        if (b === 'clear') delete map[k];
        else map[k] = b;
      }
      return { ...p, availability: { ...p.availability, [driverId]: map } };
    });

  let lastDay = '';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Driver availability</h2>
        <span className="muted">
          {plan.slotMin}-minute slots · rows in {tzName} · cells show each driver's local time
        </span>
      </div>
      <div className="toolbar" role="radiogroup" aria-label="Paint with">
        <span className="muted">Paint:</span>
        {BRUSHES.map((b) => (
          <button key={b} role="radio" aria-checked={brush === b} className={`brush brush-${b} ${brush === b ? 'on' : ''}`} onClick={() => setBrush(b)}>
            {b === 'clear' ? 'Clear' : AVAIL_LABEL[b]}
          </button>
        ))}
        <span className="muted hide-narrow">Click or drag over cells.</span>
      </div>
      <div className="table-wrap avail-wrap">
        <table className="avail">
          <thead>
            <tr>
              <th className="sticky-col">Time</th>
              <th>Stint</th>
              {drivers.map((d) => (
                <th key={d.id}>
                  <div className="avail-head">
                    <span className="swatch" style={{ background: d.color }} />
                    <span>{d.name}</span>
                    <span className="muted">{offsetLabel(d.utcOffset * 60)}</span>
                    <button className="link tiny" onClick={() => paint(d.id, slots.map((t) => new Date(t).toISOString()))}>
                      Fill
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((t) => {
              const key = new Date(t).toISOString();
              const day = dateLabel(t, tz(t));
              const newDay = day !== lastDay;
              lastDay = day;
              const s = stintAt(t);
              return (
                <tr key={key} className={newDay ? 'day-start' : ''}>
                  <th className="sticky-col mono" scope="row">
                    {newDay && <span className="day">{day}</span>}
                    {clock(t, tz(t))}
                  </th>
                  <td className="stint-cell">
                    {s && (
                      <span className="stint-tag" style={{ borderColor: s.driver?.color ?? 'var(--line)' }}>
                        {s.index}
                      </span>
                    )}
                  </td>
                  {drivers.map((d) => {
                    const st = plan.availability[d.id]?.[key];
                    const assigned = s?.stint.driverId === d.id;
                    return (
                      <td
                        key={d.id}
                        className={`cell ${st ? `cell-${st}` : 'cell-none'} ${assigned ? 'cell-assigned' : ''}`}
                        title={`${d.name}: ${st ? AVAIL_LABEL[st] : 'No info'}${assigned ? ' (driving)' : ''}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          painting.current = true;
                          paint(d.id, [key]);
                        }}
                        onPointerEnter={() => painting.current && paint(d.id, [key])}
                      >
                        <span className="mono">{clock(t, d.utcOffset * 60)}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">A bold outline marks the slots where that driver is scheduled. Stints show as blocked if any slot they cover is blocked.</p>
    </section>
  );
}
