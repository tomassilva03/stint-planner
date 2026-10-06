import { uid, type Plan } from '../model';
import { Field } from '../ui';
import type { ViewProps } from './Overview';

const FIELDS: { key: keyof Plan['notes']; label: string; team?: boolean; placeholder: string }[] = [
  { key: 'goals', label: 'Goals', placeholder: 'e.g. Top 10 in class, no incidents over 12x' },
  { key: 'qualifyingDriver', label: 'Qualifying driver', team: true, placeholder: 'Who qualifies' },
  { key: 'registeringDrivers', label: 'Registering drivers', team: true, placeholder: 'Who registers the team and when' },
  { key: 'retirement', label: 'Retirement conditions', placeholder: 'When do we call it a day' },
  { key: 'comms', label: 'Backup comms', team: true, placeholder: 'Discord channel, phone group…' },
  { key: 'setupLink', label: 'Setup', placeholder: 'Link or name of the setup' },
  { key: 'practice', label: 'Practice schedule', placeholder: 'Practice sessions before the race' },
  { key: 'general', label: 'Other notes', placeholder: '' },
];

export function Notes({ plan, update }: ViewProps) {
  const set = (fn: (p: Plan) => void) =>
    update((p) => {
      const copy = structuredClone(p);
      fn(copy);
      return copy;
    });
  const groups: { id: 'incoming' | 'outgoing'; title: string }[] = [
    { id: 'incoming', title: 'Getting in the car' },
    { id: 'outgoing', title: 'Handing over' },
  ];
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Strategy</h2>
        <div className="stack tight">
          {FIELDS.filter((f) => !f.team || plan.mode === 'team').map((f) => (
            <div className="labeled" key={f.key}>
              <label htmlFor={`note-${f.key}`}>{f.label}</label>
              <textarea
                id={`note-${f.key}`}
                className="input"
                rows={f.key === 'general' ? 4 : 2}
                placeholder={f.placeholder}
                defaultValue={plan.notes[f.key]}
                key={`${plan.id}-${f.key}`}
                onBlur={(e) => e.target.value !== plan.notes[f.key] && set((p) => void (p.notes[f.key] = e.target.value))}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Driver change checklist</h2>
        {groups.map((g) => (
          <div key={g.id} className="checklist">
            <h3>{g.title}</h3>
            <ol>
              {plan.checklist
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.group === g.id)
                .map(({ c, i }) => (
                  <li key={c.id}>
                    <Field id={`chk-${c.id}`} ariaLabel="Checklist item" className="input" value={c.text} onCommit={(v) => set((p) => void (p.checklist[i].text = v))} />
                    <button className="icon-btn" aria-label="Remove item" onClick={() => set((p) => void p.checklist.splice(i, 1))}>
                      ×
                    </button>
                  </li>
                ))}
            </ol>
            <button className="btn small" onClick={() => set((p) => void p.checklist.push({ id: uid(), group: g.id, text: 'New item' }))}>
              Add item
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
