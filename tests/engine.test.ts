import { describe, expect, it } from 'vitest';
import SunCalc from 'suncalc';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import { formatFeetInches, parseFeetInches } from '../src/engine/units';
import { solarPosition, sunVectorSite } from '../src/engine/solar';
import { localToUtc, tzAbbrev } from '../src/engine/time';
import { buildSunScene, checkPrintedDimensions, loadSite } from '../src/engine/site';
import { classify, computeSunHours, zoneStats } from '../src/engine/sunhours';
import type { EngineConfig, SiteConfig } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;

describe('units', () => {
  it('formats and parses feet-inches', () => {
    expect(formatFeetInches(50.6875)).toBe(`50'-8 1/4"`);
    expect(formatFeetInches(50 + 8.75 / 12)).toBe(`50'-8 3/4"`);
    expect(formatFeetInches(4)).toBe(`4'-0"`);
    expect(formatFeetInches(0.5)).toBe(`0'-6"`);
    expect(parseFeetInches(`50'-8 1/4"`)).toBeCloseTo(50 + 8.25 / 12, 9);
    expect(parseFeetInches(`4'-0"`)).toBe(4);
    expect(parseFeetInches(`150'-5 5/8"`)).toBeCloseTo(150 + 5.625 / 12, 9);
  });
});

describe('M1: printed plan dimensions', () => {
  it('every printed dimension measures within 1 inch', () => {
    const checks = checkPrintedDimensions(site, 1);
    expect(checks.length).toBe(10);
    for (const c of checks) expect(c.ok, `${c.label}: off by ${c.deltaInches.toFixed(2)} in`).toBe(true);
  });

  it('editing the config alone moves a structure and the check notices', () => {
    const moved: SiteConfig = JSON.parse(JSON.stringify(site));
    const adu = moved.structures.find((s) => s.id === 'adu')!;
    adu.footprint = adu.footprint.map(([x, y]) => [x, y + 2]);
    const bad = checkPrintedDimensions(moved, 1).filter((c) => !c.ok);
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('M2: solar position', () => {
  const tz = site.timeZone;
  const presets = engine.sun.presets;

  it('reports Pacific Standard/Daylight time correctly', () => {
    expect(tzAbbrev(tz, localToUtc(tz, 2026, 12, 21, 12, 0))).toBe('PST');
    expect(tzAbbrev(tz, localToUtc(tz, 2026, 6, 21, 12, 0))).toBe('PDT');
  });

  it('solar-noon elevation matches 90 - lat + declination within 0.5 deg for the four presets', () => {
    for (const p of presets) {
      let best = { el: -90, az: 0, decl: 0 };
      for (let m = 600; m < 840; m += 1) {
        const s = solarPosition(localToUtc(tz, 2026, p.month, p.day, 0, m), site.latitude, site.longitude, false);
        if (s.elevationDeg > best.el) best = { el: s.elevationDeg, az: s.azimuthDeg, decl: s.declinationDeg };
      }
      expect(best.el).toBeCloseTo(90 - site.latitude + best.decl, 1);
      expect(Math.abs(best.az - 180)).toBeLessThan(1);
    }
    const dec = presets.find((p) => p.id === 'winter')!;
    const jun = presets.find((p) => p.id === 'summer')!;
    const noon = (p: { month: number; day: number }) =>
      Math.max(...Array.from({ length: 240 }, (_, i) => solarPosition(localToUtc(tz, 2026, p.month, p.day, 0, 600 + i), site.latitude, site.longitude, false).elevationDeg));
    expect(noon(dec)).toBeCloseTo(32.5, 0);
    expect(noon(jun)).toBeCloseTo(79.4, 0);
  });

  it('agrees with an independent implementation (suncalc) within 0.5 deg above 10 deg elevation', () => {
    let compared = 0;
    for (const p of presets) {
      for (let h = 6; h <= 19; h++) {
        const utc = localToUtc(tz, 2026, p.month, p.day, h, 0);
        const mine = solarPosition(utc, site.latitude, site.longitude, false);
        if (mine.elevationDeg < 10) continue;
        const ref = SunCalc.getPosition(new Date(utc), site.latitude, site.longitude);
        const refAz = ((ref.azimuth * 180) / Math.PI + 180 + 360) % 360;
        const refEl = (ref.altitude * 180) / Math.PI;
        expect(Math.abs(mine.elevationDeg - refEl)).toBeLessThan(0.5);
        expect(Math.abs(mine.azimuthDeg - refAz)).toBeLessThan(0.5);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(30);
  });

  it('rotates the sun into site axes using the rear bearing', () => {
    // Sun due south at 45 deg; rear bears 330 so the rear faces NNW and the sun is behind the street side.
    const v = sunVectorSite(330, 'left', 180, 45);
    expect(v[2]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v[1]).toBeLessThan(0); // toward the street
    expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    // A rear bearing of 0 puts a due-north sun straight down +Y.
    const n = sunVectorSite(0, 'left', 0, 30);
    expect(n[1]).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 6);
    expect(n[0]).toBeCloseTo(0, 6);
  });
});

describe('M2: sun hours', () => {
  const scene = buildSunScene(site, { aduEnabled: true }, engine);
  const empty = { ...scene, solids: [], footprints: [] };
  const day = (m: number, d: number) => ({ kind: 'day' as const, month: m, day: d });

  it('open ground gets about the day length (winter ~10 h, summer ~14 h)', () => {
    const w = computeSunHours(empty, { period: day(12, 21), year: 2026, config: engine.sun });
    const s = computeSunHours(empty, { period: day(6, 21), year: 2026, config: engine.sun });
    expect(w.hours[0]).toBeGreaterThan(9.3);
    expect(w.hours[0]).toBeLessThan(10.2);
    expect(s.hours[0]).toBeGreaterThan(13.4);
    expect(s.hours[0]).toBeLessThan(14.4);
  });

  it('structures only remove sun and mask their own cells', () => {
    const r = computeSunHours(scene, { period: day(12, 21), year: 2026, config: engine.sun });
    const open = computeSunHours(empty, { period: day(12, 21), year: 2026, config: engine.sun });
    let masked = 0;
    for (let k = 0; k < r.hours.length; k++) {
      expect(r.hours[k]).toBeLessThanOrEqual(open.hours[k] + 1e-4);
      if (r.mask[k] === 2) masked++;
    }
    expect(masked).toBeGreaterThan(1500); // house + garage + ADU footprints
  });

  it('winter is shadier than summer, and removing the ADU adds sun behind the house', () => {
    const win = zoneStats(computeSunHours(scene, { period: day(12, 21), year: 2026, config: engine.sun }), engine.sun.classes);
    const sum = zoneStats(computeSunHours(scene, { period: day(6, 21), year: 2026, config: engine.sun }), engine.sun.classes);
    const back = (z: typeof win) => z.find((x) => x.id === 'back_yard')!;
    expect(back(win).meanHours).toBeLessThan(back(sum).meanHours);
    const noAdu = buildSunScene(site, { aduEnabled: false }, engine);
    const withoutAdu = zoneStats(computeSunHours(noAdu, { period: day(12, 21), year: 2026, config: engine.sun }), engine.sun.classes);
    expect(back(withoutAdu).meanHours).toBeGreaterThan(back(win).meanHours);
    expect(back(withoutAdu).area).toBeGreaterThan(back(win).area);
  });

  it('hand-worked shadow: a 10 ft wall casts a shadow of 10 / tan(el) at noon', () => {
    // Wall along x at y = 50 spanning the lot, rear axis bearing 0 so the sun at noon is to the street's -Y... use bearing 180: rear faces south.
    const mini = {
      ...empty,
      rearBearingDeg: 180,
      solids: [
        {
          id: 'wall',
          density: 1,
          points: [
            [0, 50, 0], [50, 50, 0], [0, 50.3, 0], [50, 50.3, 0],
            [0, 50, 10], [50, 50, 10], [0, 50.3, 10], [50, 50.3, 10],
          ] as [number, number, number][],
        },
      ],
    };
    const cfg = { ...engine.sun, stepMinutes: 10 };
    const r = computeSunHours(mini, { period: day(12, 21), year: 2026, config: cfg });
    // +Y bears south, so the noon sun is on the +Y side and the shadow falls toward the street (-Y).
    const noon = solarPosition(localToUtc(site.timeZone, 2026, 12, 21, 12, 0), site.latitude, site.longitude, true);
    const shadowLen = 10 / Math.tan((noon.elevationDeg * Math.PI) / 180);
    expect(shadowLen).toBeGreaterThan(14);
    const at = (y: number) => r.hours[Math.floor(y) * r.nx + 25];
    expect(at(50 - shadowLen * 0.5)).toBeLessThan(at(50 - shadowLen * 1.6) - 2);
    expect(at(60)).toBeGreaterThan(9);
  });

  it('classifies cells by the configured thresholds', () => {
    const c = engine.sun.classes;
    expect([7, 5, 3, 1].map((h) => classify(h, c))).toEqual([3, 2, 1, 0]);
    expect(classify(6, c)).toBe(3);
    expect(classify(4, c)).toBe(2);
    expect(classify(2, c)).toBe(1);
  });
});
