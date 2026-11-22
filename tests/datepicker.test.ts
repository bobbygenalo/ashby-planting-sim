import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { birthdayKeys } from '../src/engine/birthday';
import { loadSite } from '../src/engine/site';
import { doyToMonthDay, monthDayToDoy } from '../src/engine/time';
import { firstWeekday, monthGrid, stepMonth } from '../src/ui/DatePicker';

const site = loadSite(siteRaw);

describe('the date picker calendar', () => {
  it('lays a month out in weeks of seven, starting on the right weekday', () => {
    // November 2026 begins on a Sunday; February 2026 on a Sunday with 28 days; June 2026 on a Monday
    expect(firstWeekday(2026, 11)).toBe(0);
    expect(firstWeekday(2026, 6)).toBe(1);
    const nov = monthGrid(2026, 11);
    expect(nov.every((w) => w.length === 7)).toBe(true);
    expect(nov[0][0]).toBe(1);
    expect(nov.flat().filter((d) => d !== null)).toHaveLength(30);
    const jun = monthGrid(2026, 6);
    expect(jun[0][0]).toBeNull();
    expect(jun[0][1]).toBe(1);
    const feb = monthGrid(2026, 2);
    expect(feb.flat().filter((d) => d !== null)).toHaveLength(28);
    expect(feb).toHaveLength(4); // exactly four weeks
    // days run in order with no gaps
    for (let m = 1; m <= 12; m++) {
      const days = monthGrid(2026, m).flat().filter((d): d is number => d !== null);
      expect(days).toEqual(Array.from({ length: days.length }, (_, i) => i + 1));
    }
  });

  it('knows Thanksgiving 2026 is a Thursday, so the grid puts the 26th in the Thursday column', () => {
    const nov = monthGrid(2026, 11);
    const row = nov.find((w) => w.includes(26))!;
    expect(row.indexOf(26)).toBe(4);
  });

  it('steps between months and wraps the year', () => {
    expect(stepMonth(6, 1)).toBe(7);
    expect(stepMonth(6, -1)).toBe(5);
    expect(stepMonth(12, 1)).toBe(1);
    expect(stepMonth(1, -1)).toBe(12);
  });

  it('turns a picked day into the day of the year the simulation uses, and back', () => {
    for (const [m, d] of [[1, 1], [3, 30], [6, 4], [12, 31], [8, 15]] as const) {
      expect(doyToMonthDay(monthDayToDoy(m, d))).toEqual([m, d]);
    }
  });

  it('marks the birthdays, two names on a shared day', () => {
    const keys = birthdayKeys(site.residents!);
    expect(keys.size).toBe(14);
    expect(keys.get('3-30')).toBe('Jemma');
    expect(keys.get('6-4')).toMatch(/Madeleine/);
    expect(keys.get('6-4')).toMatch(/Abby/);
    expect(keys.get('1-1')).toBeUndefined();
  });
});
