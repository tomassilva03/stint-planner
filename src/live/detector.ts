// Turns a stream of sim samples into race events (pit stops, laps, cautions,
// driver changes) and a small live snapshot. Pure: no SDK, no clock of its own,
// so it runs the same in the helper, in tests and in the demo.
import { FLAG_CHECKERED, isCaution, type LiveEvent, type LiveState, type Sample } from './protocol';

/** How many recent green laps the averages use */
const AVG_LAPS = 5;
/** iRacing updates the last lap time a moment after the lap counter; wait at most this long for it */
const LAP_TIME_WAIT_SEC = 3;

interface PendingLap {
  laps: number;
  at: number;
  sessionTime: number;
  fuel: number | null;
  green: boolean;
}

export class Detector {
  private prev: Sample | null = null;
  private pitEntryAt: number | null = null;
  private stoppedInBox = false;
  /** A pit visit or caution happened since the last line crossing */
  private dirtyLap = false;
  private lineFuel: number | null = null;
  private pending: PendingLap | null = null;
  private greenLaps: number[] = [];
  private greenFuel: number[] = [];
  private last: Sample | null = null;
  private finished = false;
  readonly history: LiveEvent[] = [];

  /** Feed one sample taken at wall clock time `now` (ms). Returns the events it produced. */
  push(s: Sample, now: number): LiveEvent[] {
    const out: LiveEvent[] = [];
    const p = this.prev;
    // A new session: another session number or type, or the session clock jumped back
    if (p && (p.sessionNum !== s.sessionNum || p.sessionType !== s.sessionType || s.sessionTime < p.sessionTime - 1)) this.reset();
    const prev = this.prev;
    this.last = s;
    const race = s.sessionType === 'Race';
    const make = <K extends LiveEvent['kind']>(kind: K, extra: Omit<Extract<LiveEvent, { kind: K }>, 'id' | 'at' | 'lapsCompleted' | 'kind'>) =>
      ({ kind, id: `${kind}-${s.sessionNum}-${s.lapsCompleted}`, at: new Date(now).toISOString(), lapsCompleted: s.lapsCompleted, ...extra }) as unknown as LiveEvent;

    if (!prev) {
      this.prev = s;
      this.lineFuel = s.fuelLevel;
      // We didn't see this lap start (often the race start itself), so it isn't a clean lap
      this.dirtyLap = true;
      return out;
    }

    // Pit road
    if (s.onPitRoad) {
      this.dirtyLap = true;
      if (s.inPitStall) this.stoppedInBox = true;
    }
    if (s.onPitRoad && !prev.onPitRoad) {
      this.pitEntryAt = now;
      this.stoppedInBox = s.inPitStall;
      if (race) out.push(make('pitEntry', {}));
    }
    if (!s.onPitRoad && prev.onPitRoad) {
      const stopSec = this.pitEntryAt == null ? null : Math.round((now - this.pitEntryAt) / 100) / 10;
      // Only a visit whose entry we saw counts as a stop; leaving the garage when joining doesn't
      if (race) out.push(make('pitExit', { stopSec, stopped: this.stoppedInBox && this.pitEntryAt != null }));
      this.pitEntryAt = null;
      this.stoppedInBox = false;
    }

    // Caution
    const caution = isCaution(s.flags);
    if (caution) this.dirtyLap = true;
    if (race && caution !== isCaution(prev.flags)) out.push(make(caution ? 'cautionStart' : 'cautionEnd', {}));

    // Driver
    if (race && s.driverName && prev.driverName && s.driverName !== prev.driverName) {
      out.push({ ...make('driverChange', { driverName: s.driverName }), id: `driverChange-${s.sessionNum}-${s.lapsCompleted}-${s.driverName}` } as LiveEvent);
    }

    // Finish: the first line crossing once the chequered flag is out
    if (race && !this.finished && s.lapsCompleted > prev.lapsCompleted && (s.flags & FLAG_CHECKERED) !== 0) {
      this.finished = true;
      out.push(make('finish', {}));
    }

    // Laps: wait for the new lap time, then emit
    if (this.pending && (s.lastLapTime !== prev.lastLapTime || s.sessionTime - this.pending.sessionTime >= LAP_TIME_WAIT_SEC)) {
      out.push(this.finishLap(s));
    }
    if (s.lapsCompleted > prev.lapsCompleted) {
      if (this.pending) out.push(this.finishLap(prev));
      const fuelUsed = this.lineFuel != null && s.fuelLevel != null ? this.lineFuel - s.fuelLevel : null;
      this.pending = { laps: s.lapsCompleted, at: now, sessionTime: s.sessionTime, fuel: fuelUsed, green: !this.dirtyLap && s.lapsCompleted - prev.lapsCompleted === 1 };
      this.lineFuel = s.fuelLevel;
      this.dirtyLap = s.onPitRoad || caution;
      if (s.lastLapTime !== prev.lastLapTime) out.push(this.finishLap(s));
    }

    this.prev = s;
    this.history.push(...out);
    return out;
  }

  private finishLap(s: Sample): LiveEvent {
    const l = this.pending!;
    this.pending = null;
    const lapTime = s.lastLapTime > 0 ? s.lastLapTime : null;
    const fuelUsed = l.fuel != null && l.fuel > 0 ? Math.round(l.fuel * 1000) / 1000 : null;
    if (l.green) {
      if (lapTime) this.greenLaps = [...this.greenLaps, lapTime].slice(-AVG_LAPS);
      if (fuelUsed) this.greenFuel = [...this.greenFuel, fuelUsed].slice(-AVG_LAPS);
    }
    return { kind: 'lap', id: `lap-${s.sessionNum}-${l.laps}`, at: new Date(l.at).toISOString(), lapsCompleted: l.laps, lapTime, fuelUsed, green: l.green };
  }

  private reset() {
    this.prev = null;
    this.pitEntryAt = null;
    this.stoppedInBox = false;
    this.dirtyLap = false;
    this.lineFuel = null;
    this.pending = null;
    this.finished = false;
    this.greenLaps = [];
    this.greenFuel = [];
    this.history.length = 0;
  }

  state(): LiveState {
    const s = this.last;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      connected: !!s,
      isRace: s?.sessionType === 'Race',
      track: s?.track ?? '',
      car: s?.car ?? '',
      driverName: s?.driverName ?? '',
      lapsCompleted: s?.lapsCompleted ?? 0,
      lastLapTime: s && s.lastLapTime > 0 ? s.lastLapTime : null,
      avgLapTime: avg(this.greenLaps),
      fuelLevel: s?.fuelLevel ?? null,
      fuelPerLap: avg(this.greenFuel),
      onPitRoad: s?.onPitRoad ?? false,
      caution: s ? isCaution(s.flags) : false,
      sessionTimeRemain: s && s.sessionTimeRemain >= 0 && s.sessionTimeRemain < 7 * 86400 ? s.sessionTimeRemain : null,
    };
  }
}
