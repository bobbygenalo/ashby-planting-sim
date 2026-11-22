import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { footprint } from '../src/engine/hardscape';
import { pointInPolygon } from '../src/engine/geometry';
import { sedanHome, sedanSpot, sedanSpotFor, weekdayOf } from '../src/engine/vehicle';
import type { EngineConfig, HardscapeElement } from '../src/engine/types';
import { loadSite } from '../src/engine/site';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.vehicle;
const site = loadSite(siteRaw);
const els = site.hardscape as HardscapeElement[];
const Y = engine.referenceYear;

describe('the white sedan', () => {
  it('knows the day of the week', () => {
    expect(weekdayOf(2026, 7, 4)).toBe(6); // a Saturday
    expect(weekdayOf(2026, 11, 23)).toBe(1); // a Monday
  });

  it('is home on weekdays from midnight to 7 am and from 7 pm to midnight, and away between', () => {
    const mon = [11, 23] as const;
    expect(sedanHome(Y, ...mon, 0, cfg)).toBe(true);
    expect(sedanHome(Y, ...mon, 6 * 60 + 59, cfg)).toBe(true);
    expect(sedanHome(Y, ...mon, 7 * 60, cfg)).toBe(false);
    expect(sedanHome(Y, ...mon, 12 * 60, cfg)).toBe(false);
    expect(sedanHome(Y, ...mon, 19 * 60 - 1, cfg)).toBe(false);
    expect(sedanHome(Y, ...mon, 19 * 60, cfg)).toBe(true);
    expect(sedanHome(Y, ...mon, 23 * 60 + 59, cfg)).toBe(true);
  });

  it('is not shown on Saturdays or Sundays', () => {
    for (const d of [[11, 21], [11, 22]] as const) for (const m of [0, 8 * 60, 20 * 60]) expect(sedanHome(Y, d[0], d[1], m, cfg)).toBe(false);
    for (const d of [[11, 23], [11, 24], [11, 25], [11, 26], [11, 27]] as const) expect(sedanHome(Y, d[0], d[1], 21 * 60, cfg)).toBe(true);
  });

  it('stands at the street end of the driveway, on it, nose toward the garage', () => {
    const spot = sedanSpotFor(els, (e) => footprint(e, engine.hardscape), cfg)!;
    expect(spot).toBeTruthy();
    const dw = footprint(els.find((e) => e.keepClear)!, engine.hardscape);
    for (const p of spot.poly) expect(pointInPolygon(p[0], p[1], dw) || Math.abs(p[1] - Math.min(...dw.map((q) => q[1]))) < 5).toBe(true);
    for (const p of spot.poly) expect(pointInPolygon(p[0], p[1] + 0.01, dw)).toBe(true);
    expect(spot.center[1]).toBeLessThan(25);
    expect(spot.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(spot.length).toBe(cfg.lengthFt);
  });

  it('is gone when the driveway is removed or too narrow', () => {
    expect(sedanSpotFor(els.map((e) => (e.keepClear ? { ...e, removed: true } : e)), (e) => footprint(e, engine.hardscape), cfg)).toBeNull();
    expect(sedanSpot([[0, 0], [3, 0], [3, 50], [0, 50]], cfg)).toBeNull();
    expect(sedanSpot(null, cfg)).toBeNull();
  });
});
