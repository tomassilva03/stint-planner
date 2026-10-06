// Formatting and parsing for race times. All instants are UTC epoch ms;
// `offsetMin` shifts them into the zone being displayed.
const pad = (n: number, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const shifted = (t: number, offsetMin: number) => new Date(t + offsetMin * 60_000);

export function clock(t: number, offsetMin = 0, seconds = false): string {
  if (!Number.isFinite(t)) return '–';
  const d = shifted(t, offsetMin);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

export function dayClock(t: number, offsetMin = 0): string {
  if (!Number.isFinite(t)) return '–';
  return `${DAYS[shifted(t, offsetMin).getUTCDay()]} ${clock(t, offsetMin)}`;
}

export function dateLabel(t: number, offsetMin = 0): string {
  const d = shifted(t, offsetMin);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
}

/** 4142.3 -> "1:09:02" */
export function duration(sec: number, withSeconds = true): string {
  if (!Number.isFinite(sec)) return '–';
  const sign = sec < 0 ? '-' : '';
  const s = Math.round(Math.abs(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return withSeconds ? `${sign}${h}:${pad(m)}:${pad(s % 60)}` : `${sign}${h}:${pad(m)}`;
}

/** Signed delta like "+0:42" or "-1:05:10" */
export function delta(sec: number): string {
  if (!Number.isFinite(sec)) return '–';
  const s = Math.round(Math.abs(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const body = h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  return `${sec < 0 ? '-' : '+'}${body}`;
}

/** 126.04 -> "2:06.040" */
export function lapTime(sec: number): string {
  if (!(sec > 0)) return '';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** "2:06.04" | "126.04" | "2:06" -> seconds */
export function parseLapTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 2) return null;
  const n = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "h:mm" or "h:mm:ss" -> minutes */
export function parseHm(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  const [h, m = 0, s = 0] = parts;
  return h * 60 + m + s / 60;
}

/**
 * Read a wall-clock time ("17:00" or "17:00:12") typed in the displayed zone and
 * place it on whichever day puts it closest to `near`.
 */
export function parseClockNear(text: string, near: number, offsetMin: number): number | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  const local = shifted(near, offsetMin);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const base = day + ((h * 60 + mi) * 60 + s) * 1000 - offsetMin * 60_000;
  const options = [base - 86_400_000, base, base + 86_400_000];
  return options.reduce((best, t) => (Math.abs(t - near) < Math.abs(best - near) ? t : best));
}

/** UTC ISO -> value for <input type="datetime-local"> showing UTC */
export const isoToInputUtc = (iso: string) => (iso ? iso.slice(0, 16) : '');
export const inputUtcToIso = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : '');

export const offsetLabel = (offsetMin: number) => {
  if (!offsetMin) return 'UTC';
  const h = Math.floor(Math.abs(offsetMin) / 60);
  const m = Math.abs(offsetMin) % 60;
  return `UTC${offsetMin < 0 ? '-' : '+'}${h}${m ? `:${pad(m)}` : ''}`;
};

export const simClock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.floor(min % 60))}`;

/** "10" -> 10 min, "2:30" -> 2 min 30 s, "1:05:00" -> 1 h 5 min. Returns seconds. */
export function parseDurationText(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** 610 -> "10:10", 3725 -> "1:02:05" */
export function shortDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
