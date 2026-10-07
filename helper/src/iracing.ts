// Reads the iRacing SDK (Windows only) and turns each tick into a Sample.
import type { Sample } from '../../src/live/protocol.ts';

type Sdk = import('irsdk-node').IRacingSDK;
type SdkModule = typeof import('irsdk-node');

/** iRacing CarIdxTrackSurface value for a car stopped in its pit box */
const IN_PIT_STALL = 1;

export async function loadSdk(): Promise<SdkModule | null> {
  try {
    // irsdk-node quietly falls back to made-up data when its Windows module can't load; treat that as no SDK
    const native = await import('@irsdk-node/native');
    if (native.sdkIsMocked) return null;
    return await import('irsdk-node');
  } catch {
    return null;
  }
}

export class IRacingReader {
  private session: ReturnType<Sdk['getSessionData']> = null;
  private sessionVer = -1;

  constructor(private sdk: Sdk) {}

  /** Waits up to `timeoutMs` for fresh data and returns a sample, or null if iRacing isn't sending any. */
  read(timeoutMs: number): Sample | null {
    if (!this.sdk.waitForData(timeoutMs)) return null;
    const ver = this.sdk.getSessionVersionNum();
    if (ver !== this.sessionVer) {
      this.session = this.sdk.getSessionData();
      this.sessionVer = ver;
    }
    const s = this.session;
    if (!s) return null;
    const v = <T = number>(name: string): T[] | undefined => (this.sdk.getTelemetryVariable(name as never) as { value: T[] } | null)?.value;
    const one = <T = number>(name: string, fallback: T): T => v<T>(name)?.[0] ?? fallback;

    const carIdx = s.DriverInfo?.DriverCarIdx ?? one('PlayerCarIdx', 0);
    const at = <T>(name: string, fallback: T): T => v<T>(name)?.[carIdx] ?? fallback;
    const sessionNum = one('SessionNum', 0);
    const driver = s.DriverInfo?.Drivers?.find((d) => d.CarIdx === carIdx);
    const driving = one<boolean>('IsOnTrack', false);
    return {
      sessionTime: one('SessionTime', 0),
      sessionNum,
      sessionType: s.SessionInfo?.Sessions?.find((x) => x.SessionNum === sessionNum)?.SessionType ?? '',
      sessionTimeRemain: one('SessionTimeRemain', -1),
      lapsCompleted: Math.max(0, at('CarIdxLapCompleted', 0)),
      lastLapTime: at('CarIdxLastLapTime', -1),
      onPitRoad: at<boolean>('CarIdxOnPitRoad', false),
      inPitStall: at<number>('CarIdxTrackSurface', -1) === IN_PIT_STALL,
      // Fuel is only reported for the car you are driving yourself
      fuelLevel: driving ? one('FuelLevel', 0) : null,
      flags: one('SessionFlags', 0),
      driverName: driver?.UserName ?? '',
      track: s.WeekendInfo?.TrackDisplayName ?? '',
      car: driver?.CarScreenName ?? '',
    };
  }
}
