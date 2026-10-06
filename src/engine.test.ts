import { describe, expect, it } from 'vitest';
import { autoAssign, compute, normalize, spreadSafetyCars } from './engine';
import { newPlan } from './model';
import { samplePlan } from './sample';
import { NURBURGRING_SHEET_ENDS, nurburgringPlan } from './samples/nurburgring';

// Stint end times (UTC) from the Schedule tab of the example workbook.
const SHEET_ENDS = [
  '13:49:02', '14:58:04', '16:07:07', '17:00:00', '18:10:38', '19:21:16', '20:30:33', '21:38:15',
  '22:45:57', '23:54:19', '01:02:41', '02:10:23', '03:18:05', '04:25:46', '05:33:28', '06:41:50',
  '07:50:12', '08:58:34', '10:06:56', '11:15:18', '12:23:40', '12:40:00',
];
const hms = (t: number) => new Date(t).toISOString().slice(11, 19);

describe('matches the example spreadsheet', () => {
  // The sheet's time-of-day VLOOKUP runs over an unsorted range, so stints starting
  // between 21:00 and 24:00 sim time get factor 1.0 instead of the Night2 0.99.
  // Reproduce that quirk here so every stint can be compared.
  const sheetLike = samplePlan();
  sheetLike.todPeriods = [...sheetLike.todPeriods, { id: 'quirk', label: 'Sheet quirk', start: '21:00', factor: 1 }];
  const calc = compute(sheetLike);
  it('fuel stint basics', () => {
    expect(calc.lapsPerStint.standard).toBe(32);
    expect(calc.lapsPerStint.save).toBe(33);
    expect(calc.active.length).toBe(22);
  });
  it('stint end times within 1s', () => {
    calc.active.forEach((s, i) => {
      const want = SHEET_ENDS[i];
      const got = s.isFinal ? hms(calc.raceEnd) : hms(s.end);
      const diff = Math.abs(Date.parse(`2000-01-01T${got}Z`) - Date.parse(`2000-01-01T${want}Z`));
      expect(diff, `stint ${i + 1}: ${got} vs ${want}`).toBeLessThanOrEqual(1000);
    });
  });
  it('final stint is 8 laps', () => {
    const last = calc.active[calc.active.length - 1];
    expect(last.isFinal).toBe(true);
    expect(last.laps).toBe(8);
  });
  it('flags back-to-back over preference', () => {
    // The Albino prefers 1 stint in a row; stints 8-9 are a double
    expect(calc.active[8].overPref).toBe(true);
  });
});

describe('planning helpers', () => {
  it('normalize fills the race with stints', () => {
    const p = normalize({ ...newPlan('solo'), baseLapTime: 100 });
    const c = compute(p);
    expect(c.active[c.active.length - 1].isFinal).toBe(true);
    expect(c.stints.every((s) => !s.isSurplus)).toBe(true);
  });
  it('autoAssign gives every stint a driver', () => {
    const base = samplePlan();
    const p = autoAssign(normalize({ ...base, stints: base.stints.map((s) => ({ ...s, driverId: null })) }));
    expect(compute(p).active.every((s) => s.stint.driverId)).toBe(true);
  });
});

describe('league rules', () => {
  const league = () => {
    const p = samplePlan();
    p.eventKind = 'league';
    p.rules.safetyCar.enabled = true;
    return p;
  };
  it('safety car laps stretch a stint', () => {
    const p = league();
    p.stints[0] = { ...p.stints[0], scLaps: 4 };
    const c = compute(p);
    // 4 SC laps burn 1.39 L, leaving room for 31 green laps: 35 laps instead of 32
    expect(c.active[0].scLaps).toBe(4);
    expect(c.active[0].laps).toBe(35);
    expect(c.active[0].pitIn - c.active[0].start).toBeGreaterThan(compute(samplePlan()).active[0].pitIn - compute(samplePlan()).active[0].start);
  });
  it('safety car laps logged in a special event count too', () => {
    const p = samplePlan();
    p.stints[0] = { ...p.stints[0], scLaps: 4 };
    expect(compute(p).active[0].laps).toBe(35);
  });
  it('a stop under the safety car uses the shorter pit time', () => {
    const p = league();
    p.stints[0] = { ...p.stints[0], pitUnderSc: true };
    expect(compute(p).active[0].pitSec).toBe(p.rules.safetyCar.pitSec);
  });
  it('counts tyre sets against the limit', () => {
    const p = league();
    p.rules.tyreSets = { enabled: true, setsAvailable: 5, includesStartSet: true };
    p.stints = p.stints.map((s) => ({ ...s, tires: true }));
    const c = compute(p);
    expect(c.active[4].tyreSet).toBe(5);
    expect(c.active[4].tyreOver).toBe(false);
    expect(c.active[5].tyreOver).toBe(true);
    expect(c.league?.tyreSetsUsed).toBe(c.active.length);
  });
  it('flags drivers outside the driving time limits', () => {
    const p = league();
    p.rules.driverTime = { enabled: true, minMinutes: 180, maxMinutes: 300, maxStintMinutes: 120 };
    const c = compute(p);
    const by = (id: string) => c.drivers.find((d) => d.driver.id === id)!;
    expect(by('rugen').timeIssue).toBe('under');
    expect(by('fezzik').timeIssue).toBe('over');
    expect(c.active[4].overSeatTime).toBe(true); // Fezzik's third stint in a row
  });
  it('spreads expected safety cars across the race', () => {
    const p = spreadSafetyCars(league());
    expect(compute(p).league?.scLaps).toBe(p.rules.safetyCar.expectedCount * p.rules.safetyCar.avgLaps);
  });
});

describe('unscheduled events during the race', () => {
  it('a 10 minute repair pushes every later stint back by 10 minutes', () => {
    const before = compute(samplePlan());
    const p = samplePlan();
    p.stints[1] = { ...p.stints[1], lostSec: 600 };
    const after = compute(p);
    expect(after.active[1].laps).toBe(before.active[1].laps);
    expect((after.active[1].plannedEnd - before.active[1].plannedEnd) / 1000).toBeCloseTo(600, 0);
    expect((after.active[2].start - before.active[2].start) / 1000).toBeCloseTo(600, 0);
    expect((after.active[3].start - before.active[3].start) / 1000).toBeCloseTo(600, 0);
    // stint 4 has a logged actual end, so stint 5 onwards stays anchored to it
    expect(after.active[4].start).toBe(before.active[4].start);
  });
  it('lost time in the final stint costs laps, not time', () => {
    const base = compute(samplePlan());
    const p = samplePlan();
    const lastIdx = base.active.length - 1;
    p.stints[lastIdx] = { ...p.stints[lastIdx], lostSec: 300 };
    const c = compute(p);
    expect(c.active[lastIdx].isFinal).toBe(true);
    expect(c.active[lastIdx].laps).toBeLessThan(base.active[lastIdx].laps);
  });
});

describe('Nürburgring 24h team plan matches the team spreadsheet', () => {
  const run = (quirk: boolean) => {
    const p = nurburgringPlan();
    if (quirk) p.todPeriods = p.todPeriods.map((t) => (t.start === '21:00' ? { ...t, factor: 1 } : t));
    return compute(p);
  };
  it('has the same stints, laps per tank and final stint', () => {
    const c = run(false);
    expect(c.lapsPerStint.standard).toBe(7);
    expect(c.lapsPerStint.save).toBe(8);
    expect(c.active.length).toBe(NURBURGRING_SHEET_ENDS.length);
  });
  it('adds a one-lap stint when the last full stint crosses the line just before time runs out', () => {
    const c = compute(normalize(nurburgringPlan()));
    // Stint 26 takes the line about 5 s before the clock runs out with no fuel for another lap
    expect(c.active.length).toBe(NURBURGRING_SHEET_ENDS.length + 1);
    const last = c.active[c.active.length - 1];
    expect(last.isFinal).toBe(true);
    expect(last.laps).toBe(1);
  });
  it('stint end times within 1s (sheet time-of-day quirk reproduced)', () => {
    const c = run(true);
    c.active.slice(0, -1).forEach((s, i) => {
      const got = hms(s.end);
      const want = NURBURGRING_SHEET_ENDS[i];
      const diff = Math.abs(Date.parse(`2000-01-01T${got}Z`) - Date.parse(`2000-01-01T${want}Z`));
      expect(diff, `stint ${i + 1}: ${got} vs ${want}`).toBeLessThanOrEqual(1000);
    });
  });
});
