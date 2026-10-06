// Data model for an endurance race plan.
// One shape covers iRacing special events and league races: league-only
// rules (safety cars, tyre set limits, driver time limits) live under
// `rules` and are all disabled for a special event.

export type Mode = 'solo' | 'team';
export type EventKind = 'special' | 'league';
export type StintType = 'standard' | 'save';
export type Avail = 'open' | 'tentative' | 'blocked';

export interface Driver {
  id: string;
  name: string;
  color: string;
  /** Hours from UTC, e.g. -7, 2, 9.5 */
  utcOffset: number;
  iRating: number;
  /** Typical green-flag lap time in seconds */
  lapTime: number;
  /** Most stints this driver wants to do back to back */
  maxConsecutive: number;
}

export interface TodPeriod {
  id: string;
  label: string;
  /** In-sim time of day this period starts, "HH:MM" */
  start: string;
  /** Lap time multiplier, 1.01 = 1% slower */
  factor: number;
}

export interface Stint {
  id: string;
  driverId: string | null;
  type: StintType;
  /** Change tyres at the stop that ends this stint */
  tires: boolean;
  /** Seconds added to every lap of this stint (traffic, damage, caution) */
  paceModSec: number;
  /** Live: when the car actually left the pits at the end of this stint (UTC ISO) */
  actualEnd?: string;
  /** Live: laps actually completed in this stint */
  actualLaps?: number;
  note?: string;
  /** Unscheduled time lost during this stint, seconds: repairs, a long stop, a penalty */
  lostSec?: number;
  /** Laps of this stint run behind the safety car (planned or logged) */
  scLaps?: number;
  /** The stop at the end of this stint happens under the safety car */
  pitUnderSc?: boolean;
}

export interface LeagueRules {
  safetyCar: {
    enabled: boolean;
    /** How many safety car periods to expect, used by "spread expected safety cars" */
    expectedCount: number;
    /** Laps behind the safety car per period */
    avgLaps: number;
    /** Lap time behind the safety car vs a green lap, 1.6 = 60% slower */
    lapTimeFactor: number;
    /** Fuel per lap behind the safety car vs a green lap */
    fuelFactor: number;
    /** Time lost for a stop made under the safety car (the field is slow) */
    pitSec: number;
  };
  tyreSets: { enabled: boolean; setsAvailable: number; includesStartSet: boolean };
  driverTime: { enabled: boolean; minMinutes: number; maxMinutes: number; maxStintMinutes: number };
  minPitStops: { enabled: boolean; count: number };
}

export interface ChecklistItem {
  id: string;
  group: 'incoming' | 'outgoing';
  text: string;
}

export interface Plan {
  schema: 1;
  id: string;
  name: string;
  mode: Mode;
  eventKind: EventKind;
  event: {
    /** Session start (practice/qualifying begins) in UTC ISO */
    sessionStart: string;
    /** Minutes from session start to the green flag */
    greenFlagOffsetMin: number;
    durationMin: number;
    /** In-sim time of day at the green flag, "HH:MM" */
    simStart: string;
    track: string;
    car: string;
  };
  fuel: {
    tankL: number;
    perLapL: number;
    /** Fuel-saving stints: lap time and fuel use multipliers */
    saveLapFactor: number;
    saveFuelFactor: number;
  };
  pit: {
    /** Pit lane loss plus refuel, seconds */
    stopSec: number;
    tireSec: number;
    tiresByDefault: boolean;
  };
  /** Used in solo mode, and in team mode when no driver lap times are set */
  baseLapTime: number;
  todPeriods: TodPeriod[];
  drivers: Driver[];
  /** driverId -> slot start (UTC ISO) -> status */
  availability: Record<string, Record<string, Avail>>;
  slotMin: number;
  stints: Stint[];
  rules: LeagueRules;
  notes: {
    qualifyingDriver: string;
    registeringDrivers: string;
    goals: string;
    retirement: string;
    comms: string;
    setupLink: string;
    practice: string;
    general: string;
  };
  checklist: ChecklistItem[];
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DRIVER_COLORS = ['#3b6fd8', '#d9480f', '#2b8a3e', '#ae3ec9', '#e8a317', '#0c8599', '#c2255c', '#5c7cfa', '#868e96', '#74b816'];

export const defaultRules = (): LeagueRules => ({
  safetyCar: { enabled: false, expectedCount: 3, avgLaps: 4, lapTimeFactor: 1.6, fuelFactor: 0.45, pitSec: 30 },
  tyreSets: { enabled: false, setsAvailable: 8, includesStartSet: true },
  driverTime: { enabled: false, minMinutes: 0, maxMinutes: 0, maxStintMinutes: 0 },
  minPitStops: { enabled: false, count: 0 },
});

export const defaultChecklist = (): ChecklistItem[] => [
  { id: uid(), group: 'incoming', text: 'Run a test session before your first stint: FFB, audio, spotter and apps all working.' },
  { id: uid(), group: 'incoming', text: 'Confirm tyres and fuel are set correctly with the outgoing driver.' },
  { id: uid(), group: 'incoming', text: 'Confirm in-car settings (brake bias, diffs, TC/ABS) with the outgoing driver.' },
  { id: uid(), group: 'incoming', text: 'Know who relieves you and when. If you don’t, raise it before you get in the car.' },
  { id: uid(), group: 'outgoing', text: 'Confirm tyres and fuel are set correctly with the incoming driver.' },
  { id: uid(), group: 'outgoing', text: 'Check in-car settings together with the incoming driver.' },
  { id: uid(), group: 'outgoing', text: 'Stay in the car until the incoming driver takes over.' },
  { id: uid(), group: 'outgoing', text: 'Log the actual end time and laps for your stint. End time is when the car rejoins the track.' },
];

export const defaultTod = (): TodPeriod[] => [
  { id: uid(), label: 'Night', start: '00:00', factor: 0.99 },
  { id: uid(), label: 'Morning', start: '04:00', factor: 1 },
  { id: uid(), label: 'Afternoon', start: '11:00', factor: 1.01 },
  { id: uid(), label: 'Evening', start: '18:00', factor: 0.99 },
];

export function newDriver(index: number, name = `Driver ${index + 1}`): Driver {
  return {
    id: uid(),
    name,
    color: DRIVER_COLORS[index % DRIVER_COLORS.length],
    utcOffset: 0,
    iRating: 0,
    lapTime: 0,
    maxConsecutive: 2,
  };
}

export function newPlan(mode: Mode = 'team'): Plan {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 7);
  start.setUTCHours(12, 0, 0, 0);
  const drivers = mode === 'solo' ? [newDriver(0, 'Me')] : [newDriver(0), newDriver(1)];
  return {
    schema: 1,
    id: uid(),
    name: mode === 'solo' ? 'New solo race' : 'New team race',
    mode,
    eventKind: 'special',
    event: { sessionStart: start.toISOString(), greenFlagOffsetMin: 40, durationMin: 6 * 60, simStart: '12:00', track: '', car: '' },
    fuel: { tankL: 100, perLapL: 3, saveLapFactor: 1.01, saveFuelFactor: 0.99 },
    pit: { stopSec: 60, tireSec: 25, tiresByDefault: true },
    baseLapTime: 100,
    todPeriods: defaultTod(),
    drivers,
    availability: {},
    slotMin: 30,
    stints: [],
    rules: defaultRules(),
    notes: { qualifyingDriver: '', registeringDrivers: '', goals: '', retirement: '', comms: '', setupLink: '', practice: '', general: '' },
    checklist: defaultChecklist(),
  };
}

/** Fill any fields missing from older or hand-edited saves. */
export function migrate(raw: any): Plan {
  const base = newPlan(raw?.mode === 'solo' ? 'solo' : 'team');
  return {
    ...base,
    ...raw,
    event: { ...base.event, ...raw?.event },
    fuel: { ...base.fuel, ...raw?.fuel },
    pit: { ...base.pit, ...raw?.pit },
    rules: {
      safetyCar: { ...base.rules.safetyCar, ...raw?.rules?.safetyCar },
      tyreSets: { ...base.rules.tyreSets, ...raw?.rules?.tyreSets },
      driverTime: { ...base.rules.driverTime, ...raw?.rules?.driverTime },
      minPitStops: { ...base.rules.minPitStops, ...raw?.rules?.minPitStops },
    },
    notes: { ...base.notes, ...raw?.notes },
    todPeriods: raw?.todPeriods ?? base.todPeriods,
    drivers: raw?.drivers ?? base.drivers,
    availability: raw?.availability ?? {},
    stints: raw?.stints ?? [],
    checklist: raw?.checklist ?? base.checklist,
    schema: 1,
  };
}
