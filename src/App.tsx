import { useEffect, useMemo, useRef, useState } from 'react';
import { baseLapTime, compute } from './engine';
import { migrate, newPlan, uid, type Plan } from './model';
import { samplePlan } from './sample';
import { demoPlan } from './samples/demo';
import { nurburgringPlan } from './samples/nurburgring';
import { usePlans } from './store';
import { offsetLabel } from './time';
import { BrandMark, Check, Chevron, Field, Select } from './ui';
import { AccountMenu, CloudBar } from './views/Account';
import { Availability } from './views/Availability';
import { Drivers } from './views/Drivers';
import { Notes } from './views/Notes';
import { Overview } from './views/Overview';
import { Setup } from './views/Setup';
import { Stints } from './views/Stints';
import { useLive } from './live/useLive';
import { Engineer } from './engineer/Engineer';
import { useEngineer } from './engineer/feed';
import { pitCall } from './engineer/pitCall';
import { liveRaceState } from './strategy/RaceStatePanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'setup', label: 'Race setup' },
  { id: 'drivers', label: 'Drivers', team: true },
  { id: 'availability', label: 'Availability', team: true },
  { id: 'stints', label: 'Stints' },
  { id: 'notes', label: 'Notes' },
  { id: 'engineer', label: 'Race engineer' },
];

const THEMES = ['auto', 'dark', 'light'] as const;

function ThemeIcon({ theme }: { theme: string }) {
  if (theme === 'dark') return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z" fill="currentColor" /></svg>;
  if (theme === 'light')
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
    </svg>
  );
}

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const { plans, plan, update, add, remove, select, cloud } = usePlans();
  const [tab, setTab] = useState(() => readPref('enduro-planner.tab', 'overview'));
  const [zone, setZone] = useState(() => readPref('enduro-planner.zone', 'utc'));
  const [theme, setTheme] = useState(() => readPref('enduro-planner.theme', 'auto'));
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => writePref('enduro-planner.tab', tab), [tab]);
  useEffect(() => writePref('enduro-planner.zone', zone), [zone]);
  useEffect(() => {
    writePref('enduro-planner.theme', theme);
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const calc = useMemo(() => compute(plan), [plan]);
  const live = useLive(plan, update, cloud.readOnly);
  // The pit call for the Race engineer tab, worked out here when this PC runs the helper
  const race = liveRaceState(live, plan, calc);
  const call = race ? pitCall(plan, calc, race) : null;
  const engineer = useEngineer(plan.id, live, cloud.session, !!cloud.meta[plan.id], call);
  const team = plan.mode === 'team';
  const visibleTabs = TABS.filter((t) => !t.team || team);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : 'overview';

  const zoneDriver = zone.startsWith('driver:') ? plan.drivers.find((d) => `driver:${d.id}` === zone) : undefined;
  const effectiveZone = zone.startsWith('driver:') && !zoneDriver ? 'utc' : zone;
  const tz = (t: number) =>
    effectiveZone === 'device' ? -new Date(t).getTimezoneOffset() : zoneDriver ? zoneDriver.utcOffset * 60 : 0;
  const tzName = effectiveZone === 'device' ? 'your local time' : zoneDriver ? `${zoneDriver.name}'s time (${offsetLabel(zoneDriver.utcOffset * 60)})` : 'GMT';

  const setMode = (mode: Plan['mode']) =>
    update((p) => {
      if (p.mode === mode) return p;
      if (mode === 'solo') return { ...p, mode, baseLapTime: baseLapTime(p) };
      const drivers = p.drivers.map((d, i) => (i === 0 && !d.lapTime ? { ...d, lapTime: p.baseLapTime } : d));
      return { ...p, mode, drivers };
    });

  const exportJson = () => {
    const json = JSON.stringify(plan, null, 2);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${plan.name.replace(/[^\w-]+/g, '_') || 'race-plan'}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      /* downloads blocked */
    }
    navigator.clipboard?.writeText(json).then(
      () => setNotice('Plan saved as a file and copied to the clipboard.'),
      () => setNotice('Plan saved as a file.'),
    );
    setMenu(false);
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      add({ ...migrate(data), id: uid() });
      setNotice(`Imported “${data.name ?? 'plan'}”.`);
    } catch {
      setNotice('That file is not a race plan exported from this app.');
    }
    setMenu(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span>Nightstint</span>
        </div>
        <div className="plan-picker" ref={menuRef}>
          <button className="plan-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => (setMenu(!menu), setConfirmDelete(false))}>
            <span className="plan-button-name">{plan.name}</span>
            <Chevron />
          </button>
          {menu && (
            <div className="menu plan-menu" role="menu">
              <div className="menu-label">Your plans</div>
              {plans.map((p) => (
                <button key={p.id} role="menuitemradio" aria-checked={p.id === plan.id} className="menu-option" onClick={() => (select(p.id), setMenu(false))}>
                  <span>{p.name}</span>
                  {p.id === plan.id && <Check />}
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => (add(newPlan('team')), setMenu(false))}>
                New team race
              </button>
              <button role="menuitem" onClick={() => (add(newPlan('solo')), setMenu(false))}>
                New solo race
              </button>
              <button role="menuitem" onClick={() => (add({ ...structuredClone(plan), id: uid(), name: `${plan.name} (copy)` }), setMenu(false))}>
                Duplicate this plan
              </button>
              <button role="menuitem" onClick={() => (add(nurburgringPlan()), setMenu(false))}>
                Example: Nürburgring 24h (real team plan)
              </button>
              <button role="menuitem" onClick={() => (add(samplePlan()), setMenu(false))}>
                Example: 24h team race (spreadsheet sample)
              </button>
              <button role="menuitem" onClick={() => (add(demoPlan()), live.startDemo(30), setMenu(false))}>
                Demo race: play a made-up race here, no iRacing needed
              </button>
              <hr />
              <button role="menuitem" onClick={exportJson}>
                Export plan (.json)
              </button>
              <button role="menuitem" onClick={() => fileRef.current?.click()}>
                Import plan…
              </button>
              <hr />
              {confirmDelete ? (
                <button role="menuitem" className="danger" onClick={() => (remove(plan.id), setMenu(false), setConfirmDelete(false))}>
                  {cloud.meta[plan.id] && cloud.role !== 'owner' ? `Yes, leave “${plan.name}”` : `Yes, delete “${plan.name}”`}
                </button>
              ) : (
                <button role="menuitem" className="danger" onClick={() => setConfirmDelete(true)}>
                  {cloud.meta[plan.id] && cloud.role !== 'owner' ? 'Leave this shared plan' : 'Delete this plan'}
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            id="import-file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }}
          />
        </div>
        <AccountMenu cloud={cloud} />
        <button
          className="btn theme-btn"
          title={theme === 'dark' ? 'Dark theme' : theme === 'light' ? 'Light theme' : 'Theme follows your system'}
          onClick={() => setTheme(THEMES[(THEMES.indexOf(theme as (typeof THEMES)[number]) + 1) % THEMES.length])}
        >
          <ThemeIcon theme={theme} />
          <span className="sr-only">Theme: {theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'follow system'}</span>
        </button>
        <div className="zone">
          <label htmlFor="zone-select">Times in</label>
          <Select
            id="zone-select"
            value={effectiveZone}
            onChange={setZone}
            options={[
              { value: 'utc', label: 'GMT' },
              { value: 'device', label: 'My local time' },
              ...(team
                ? plan.drivers.filter((d) => d.name.trim()).map((d) => ({ value: `driver:${d.id}`, label: `${d.name} (${offsetLabel(d.utcOffset * 60)})` }))
                : []),
            ]}
          />
        </div>
      </header>

      <div className="plan-head">
        <div className="plan-title">
          <Field id="plan-name" ariaLabel="Plan name" className="title-input" value={plan.name} onCommit={(v) => v.trim() && update((p) => ({ ...p, name: v.trim() }))} />
          <p className="muted">
            {[plan.event.track, plan.event.car].filter(Boolean).join(' · ') || 'Set the track and car in Race setup'}
          </p>
          <CloudBar plan={plan} cloud={cloud} />
        </div>
        <div className="toggles">
          <div className="seg" role="radiogroup" aria-label="Driver setup">
            {(['solo', 'team'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={plan.mode === m} className={plan.mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'solo' ? 'Solo' : 'Team'}
              </button>
            ))}
          </div>
          <div className="seg" role="radiogroup" aria-label="Event type">
            <button role="radio" aria-checked={plan.eventKind === 'special'} className={plan.eventKind === 'special' ? 'on' : ''} onClick={() => update((p) => ({ ...p, eventKind: 'special' }))}>
              Special event
            </button>
            <button role="radio" aria-checked={plan.eventKind === 'league'} className={plan.eventKind === 'league' ? 'on' : ''} onClick={() => update((p) => ({ ...p, eventKind: 'league' }))}>
              League
            </button>
          </div>
        </div>
      </div>

      <nav className="tabs" aria-label="Sections">
        {visibleTabs.map((t) => (
          <button key={t.id} className={activeTab === t.id ? 'on' : ''} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {cloud.readOnly && (
        <p className="readonly-note" role="status">
          You can view this plan but not change it. Ask {cloud.meta[plan.id]?.ownerEmail} for edit access.
        </p>
      )}
      <main className={cloud.readOnly ? 'readonly' : ''}>
        {(() => {
          const props = { plan, calc, update, tz, tzName, now, go: setTab };
          switch (activeTab) {
            case 'setup':
              return <Setup {...props} />;
            case 'drivers':
              return <Drivers {...props} />;
            case 'availability':
              return <Availability {...props} />;
            case 'stints':
              return <Stints {...props} live={live} readOnly={cloud.readOnly} />;
            case 'notes':
              return <Notes {...props} />;
            case 'engineer':
              return <Engineer plan={plan} live={live} engineer={engineer} signedIn={!!cloud.session} />;
            default:
              return <Overview {...props} />;
          }
        })()}
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <footer className="foot muted">Plans are saved in this browser. Export a plan to back it up or share it with your team.</footer>
    </div>
  );
}
