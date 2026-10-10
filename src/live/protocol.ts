// What the iRacing helper on the driving PC sends to the planner.
// Shared by the helper (helper/) and the web app so both sides agree on the shape.
import type { FieldSnapshot } from './field';

/** The helper listens on ws://localhost:LIVE_PORT */
export const LIVE_PORT = 47100;
export const PROTOCOL_VERSION = 1;

/** One reading of the sim, already reduced to what the planner needs. */
export interface Sample {
  /** Seconds since the session started (iRacing SessionTime) */
  sessionTime: number;
  sessionNum: number;
  /** "Race", "Practice", "Lone Qualify"... from the session info */
  sessionType: string;
  /** Seconds left in the session, negative or huge when unlimited */
  sessionTimeRemain: number;
  /** Laps completed by our car (CarIdxLapCompleted for the team car, so it works on any teammate's PC) */
  lapsCompleted: number;
  /** Last lap time of our car in seconds, <= 0 when unknown */
  lastLapTime: number;
  onPitRoad: boolean;
  /** Our car is stopped in its pit box (CarIdxTrackSurface == InPitStall) */
  inPitStall: boolean;
  /** Litres in the tank. Only known on the PC that is driving. */
  fuelLevel: number | null;
  /** iRacing SessionFlags bit field */
  flags: number;
  /** Who is in the car now */
  driverName: string;
  track: string;
  car: string;
  /** Incident points of our car this session (team total in a team race). Missing from older helpers. */
  incidents?: number | null;
}

export const FLAG_CHECKERED = 0x0001;
export const FLAG_CAUTION = 0x4000;
export const FLAG_CAUTION_WAVING = 0x8000;
export const isCaution = (flags: number) => (flags & (FLAG_CAUTION | FLAG_CAUTION_WAVING)) !== 0;

interface EventBase {
  /** Same on every teammate's PC for the same moment of the race, so it is only applied once */
  id: string;
  /** Wall clock time on the helper's PC, ISO */
  at: string;
  /** Car's total laps completed at that moment */
  lapsCompleted: number;
}

export type LiveEvent =
  | (EventBase & { kind: 'pitEntry' })
  | (EventBase & { kind: 'pitExit'; /** Seconds from pit entry to pit exit, if the entry was seen */ stopSec: number | null; /** False for a drive-through: the car never stopped in its box */ stopped: boolean })
  | (EventBase & {
      kind: 'lap';
      lapTime: number | null;
      fuelUsed: number | null;
      /** No pit visit and no caution during the lap */
      green: boolean;
      /** Incident points picked up during the lap; missing from older helpers */
      incidents?: number | null;
    })
  | (EventBase & { kind: 'cautionStart' })
  | (EventBase & { kind: 'cautionEnd' })
  | (EventBase & { kind: 'driverChange'; driverName: string })
  /** Our car crossed the line under the chequered flag */
  | (EventBase & { kind: 'finish' });

/** Snapshot for the live strip, sent a couple of times a second. */
export interface LiveState {
  connected: boolean;
  isRace: boolean;
  track: string;
  car: string;
  driverName: string;
  lapsCompleted: number;
  lastLapTime: number | null;
  /** Average of the last few green laps, seconds */
  avgLapTime: number | null;
  fuelLevel: number | null;
  /** Average fuel per green lap over the last few laps, litres */
  fuelPerLap: number | null;
  onPitRoad: boolean;
  caution: boolean;
  sessionTimeRemain: number | null;
  /** Incident points this session; missing from older helpers */
  incidents?: number | null;
}

export type HelperMessage =
  | { type: 'hello'; version: number; source: 'iracing' | 'demo' }
  | { type: 'state'; state: LiveState }
  | { type: 'event'; event: LiveEvent }
  /** Sent on connect: every event of the current race so far, so a refreshed page catches up */
  | { type: 'history'; events: LiveEvent[] }
  | { type: 'waiting' }
  /** The whole field for the Race engineer tab, a couple of times a second */
  | { type: 'field'; field: FieldSnapshot }
  /** The track's shape, once it is known: OUTLINE points as a flat [x, y, ...] list in 0..1000, evenly spaced round the lap */
  | { type: 'outline'; track: string; points: number[] };
