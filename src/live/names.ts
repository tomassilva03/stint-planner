// iRacing hands over names with accents broken: the SDK's session text is
// Windows-1252 and reaches Node as UTF-8, so "Tomás" arrives as "Tom�s".
// The lost letter can't be recovered from the text itself, so match it
// against the plan's drivers, where the name is spelled properly.
import type { Driver } from '../model';

const BROKEN = '�';
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The plan driver this iRacing name belongs to, if any. iRacing may add digits to a name ("Tomás Silva4"). */
export function matchDriver(raw: string, drivers: Driver[]): Driver | undefined {
  const name = raw.trim().replace(/\d+$/, '');
  if (!name) return undefined;
  const pattern = new RegExp(
    `^${[...name].map((c) => (c === BROKEN ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`,
    'iu',
  );
  return (
    drivers.find((d) => pattern.test(d.name.trim())) ??
    drivers.find((d) => !name.includes(BROKEN) && fold(d.name) === fold(name))
  );
}

/** A name fit to show: the plan's spelling when the driver is known, otherwise the raw name with "?" for lost letters. */
export function displayName(raw: string, drivers: Driver[]): string {
  return matchDriver(raw, drivers)?.name ?? raw.split(BROKEN).join('?');
}
