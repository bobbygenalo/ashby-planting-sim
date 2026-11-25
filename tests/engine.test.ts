import { describe, expect, it } from 'vitest';
import SunCalc from 'suncalc';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import { formatFeetInches, parseFeetInches } from '../src/engine/units';
import { solarPosition, sunVectorSite } from '../src/engine/solar';
import { localToUtc, tzAbbrev } from '../src/engine/time';
import { activeStructures, buildSunScene, checkPrintedDimensions, loadSite, overhangPoints, roofPoints, structureSolidPoints } from '../src/engine/site';
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
    expect(checks.length).toBe(12);
    for (const c of checks) expect(c.ok, `${c.label}: off by ${c.deltaInches.toFixed(2)} in`).toBe(true);
  });

  it('editing the config alone moves a structure and the check notices', () => {
    const moved: SiteConfig = JSON.parse(JSON.stringify(site));
    for (const part of moved.structures.filter((s) => s.group === 'adu')) {
      part.footprint = part.footprint.map(([x, y]) => [x, y + 2]);
      if (part.roofFootprint) part.roofFootprint = part.roofFootprint.map(([x, y]) => [x, y + 2]);
    }
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

describe('the ADU from the owner\'s floor and roof plans', () => {
  const inch = 1 / 12;
  const parts = site.structures.filter((s) => s.group === 'adu');
  const part = (id: string) => parts.find((s) => s.id === id)!;
  const bedroom = part('adu-bedroom'), link = part('adu-link'), great = part('adu-great');
  const area = (poly: number[][]) => Math.abs(poly.reduce((a, [x, y], i) => a + (x * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * y), 0)) / 2;
  const inside = (x: number, y: number) => parts.some((p) => pointIn(x, y, p.footprint));
  function pointIn(x: number, y: number, poly: number[][]) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (poly[i][1] > y !== poly[j][1] > y && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    }
    return c;
  }

  // The plan's dimension strings, in feet and inches, entered here independently of the site file.
  const x01 = 9 + 7 * inch, x02 = x01 + 15 + 2.375 * inch, x03 = x02 + 10 + 4.625 * inch, x04 = x03 + 11 + 3.375 * inch;
  const wall = 2.875 * inch; // exterior face outside the grid line

  it('the plan\'s dimension chain closes on the lot width, which confirms the driveway is on the left', () => {
    expect(x04 + 4 + 2.875 * inch).toBeCloseTo(site.lot.width, 3);
    expect(x01).toBeGreaterThan(site.lot.width - x04); // 9'-7" on the driveway side, 4'-2 7/8" on the other
    expect(site.driveSide).toBe('left');
  });

  it('reproduces three numbers printed on the separate plot plan', () => {
    const minY = Math.min(...parts.flatMap((p) => p.footprint.map((q) => q[1])));
    const maxY = Math.max(...parts.flatMap((p) => p.footprint.map((q) => q[1])));
    const maxX = Math.max(...parts.flatMap((p) => p.footprint.map((q) => q[0])));
    expect(minY).toBeCloseTo(123 + 4.375 * inch, 3); // front wall to front lot line, 123'-4 3/8"
    expect(site.lot.depth - maxY).toBeCloseTo(4, 3); // rear setback 4'-0"
    expect(site.lot.width - maxX).toBeCloseTo(4, 3); // side setback 4'-0"
  });

  it('puts the wall faces where the plan says', () => {
    const [x0, , x1, y1] = [bedroom.footprint[0][0], 0, bedroom.footprint[2][0], bedroom.footprint[2][1]];
    expect(x0).toBeCloseTo(8 + 11.5 * inch, 3); // west wall, 8'-11 1/2" from the lot line
    expect(x1).toBeCloseTo(x02 + wall, 3);
    expect(link.footprint[2][0]).toBeCloseTo(x03 + wall, 3);
    expect(great.footprint[0][0]).toBeCloseTo(x02 - wall, 3);
    expect(great.footprint[2][0]).toBeCloseTo(x04 + wall, 3);
    expect(y1).toBeCloseTo(site.lot.depth - 4, 3);
    // Row spacing AA to BB is 10'-10 3/4" and BB to CC is 11'-8 3/4"; the wings sit on those rows.
    const yBB = site.lot.depth - (4 + 2.875 * inch + 10 + 10.75 * inch);
    expect(bedroom.footprint[0][1]).toBeCloseTo(yBB - wall, 3);
    expect(great.footprint[2][1]).toBeCloseTo(yBB + wall, 3);
  });

  it('is an L-shape: about 566 sq ft of footprint, which with the entry landing makes the printed 616 sq ft', () => {
    const total = parts.reduce((a, p) => a + area(p.footprint), 0);
    expect(total).toBeGreaterThan(560);
    expect(total).toBeLessThan(572);
    const landing = (12 + 2.75 * inch) * 4;
    expect(Math.abs(total + landing - 616)).toBeLessThan(2);
    expect(total / (37.76 * 23.1)).toBeLessThan(0.7); // about two thirds of the old single rectangle's 872 sq ft of walls
  });

  it('leaves both notches open and covers the three wings', () => {
    expect(inside(16, 129)).toBe(false); // the yard notch at the southwest
    expect(inside(41, 141)).toBe(false); // the courtyard at the northeast
    expect(inside(16, 141)).toBe(true); // bedroom wing
    expect(inside(30, 141)).toBe(true); // bath and hall
    expect(inside(40, 128)).toBe(true); // great room
    expect(inside(30, 129)).toBe(true);
    // The wings meet without gaps: walking the rear wing's east edge reaches the great room's north edge.
    expect(link.footprint[0][1]).toBeLessThanOrEqual(great.footprint[2][1] + 1e-6);
  });

  it('shapes the roofs from the roof plan: shed roofs falling to the west, a flat roof between', () => {
    const top = (p: typeof bedroom) => roofPoints(p).filter((q) => q[2] === Math.max(...roofPoints(p).map((r) => r[2])));
    for (const p of [bedroom, great]) {
      expect(p.roofForm).toBe('shed');
      expect(p.lowSide).toBe('west');
      expect(p.ridgeHeight).toBeGreaterThan(p.eaveHeight + 2.5);
      const hi = top(p);
      const maxX = Math.max(...(p.roofFootprint ?? p.footprint).map((q) => q[0]));
      expect(hi.every((q) => Math.abs(q[0] - maxX) < 1e-6)).toBe(true); // only the east edge is high
      expect(roofPoints(p).filter((q) => q[2] === p.eaveHeight).length).toBe(4); // the wedge sits on flat wall tops
    }
    // Heights: roof-plan elevations above finished floor, plus 0.8 ft for the floor above grade.
    expect(bedroom.eaveHeight).toBeCloseTo(10 + 5 * inch + 0.8, 2);
    expect(bedroom.ridgeHeight).toBeCloseTo(13 + 1.25 * inch + 0.8, 2);
    expect(great.eaveHeight).toBeCloseTo(9 + 4 * inch + 0.8, 2);
    expect(great.ridgeHeight).toBeCloseTo(13 + 1.125 * inch + 0.8, 2);
    expect(link.roofForm).toBe('flat');
    expect(link.ridgeHeight).toBeCloseTo(9.5 + 0.8, 2);
    expect(roofPoints(link).every((q) => q[2] <= 10.31)).toBe(true);
  });

  it('reaches 2\'-5 1/4" south of the great room, which is what makes the printed width 25\'-6 1/2"', () => {
    const roofMinY = Math.min(...great.roofFootprint!.map((q) => q[1]));
    expect(great.footprint[0][1] - roofMinY).toBeCloseTo(2 + 5.25 * inch, 3);
    expect(Math.max(...bedroom.footprint.map((q) => q[1])) - roofMinY).toBeCloseTo(25 + 6.5 * inch, 3);
  });

  it('keeps every printed plan dimension within an inch, measuring the three wings as one building', () => {
    const checks = checkPrintedDimensions(site, 1);
    expect(checks.every((c) => c.ok)).toBe(true);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(Math.abs(byId['adu-clear'].deltaInches)).toBeLessThan(0.6);
    expect(Math.abs(byId['adu-length'].deltaInches)).toBeLessThan(0.5);
    expect(byId['adu-front'].deltaInches).toBeCloseTo(0, 1);
    expect(byId['adu-rear'].deltaInches).toBeCloseTo(0, 1);
    expect(byId['adu-side'].deltaInches).toBeCloseTo(0, 1);
    expect(byId['adu-width'].deltaInches).toBeCloseTo(0, 1);
  });

  it('turns off and on as one building', () => {
    expect(activeStructures(site, { aduEnabled: true }).filter((s) => s.group === 'adu').length).toBe(3);
    expect(activeStructures(site, { aduEnabled: false }).filter((s) => s.group === 'adu').length).toBe(0);
    expect(activeStructures(site, { aduEnabled: false }).length).toBe(site.structures.length - 7);
    expect(activeStructures(site, { aduEnabled: true }).filter((s) => s.group === 'adu-fins').length).toBe(4);
  });

  it('projects the roof over an open recess: side walls to the ground, a thin slab on top, nothing solid between', () => {
    const great = site.structures.find((s) => s.id === 'adu-great')!;
    const slab = overhangPoints(great)!;
    const zs = slab.map((p) => p[2]);
    expect(slab.every((p) => p[1] >= 120.92 - 1e-3 && p[1] <= 123.37 + 1e-3)).toBe(true);
    for (let i = 0; i < slab.length; i += 2) expect(slab[i][2] - slab[i + 1][2]).toBeCloseTo(0.6, 6);
    expect(Math.min(...zs)).toBeGreaterThan(9); // well above head height: open underneath
    const fin = site.structures.find((s) => s.id === 'adu-fin-great-w')!;
    expect(structureSolidPoints(fin).some((p) => p[2] === 0)).toBe(true);
    expect(roofPoints(great).every((p) => p[1] >= 123.36)).toBe(true);
    const ids = buildSunScene(site, { aduEnabled: true }, engine).solids.map((s) => s.id);
    expect(ids).toContain('adu-great:slab');
  });

  it('casts less shade than the old solid rectangle would have, and the notches get sun', () => {
    // Trees are left out of both scenes so that only the ADU's shape differs. (The ficus shades the notch in winter.)
    const bare = { ...site, contextObjects: site.contextObjects.filter((o) => o.kind !== 'tree') };
    const rect = { ...bare, structures: [...bare.structures.filter((s) => s.group !== 'adu'), { ...great, id: 'old', group: 'adu', footprint: [[8.96, 123.36], [46.72, 123.36], [46.72, 146.47], [8.96, 146.47]] as [number, number][], roofFootprint: undefined, roofForm: 'gable' as const, lowSide: undefined, eaveHeight: 9, ridgeHeight: 14 }] };
    const day = { kind: 'day' as const, month: 12, day: 21 };
    const sunTotal = (s: typeof site) => {
      const r = computeSunHours(buildSunScene(s, { aduEnabled: true }, engine), { period: day, year: 2026, config: engine.sun });
      let sum = 0;
      for (let k = 0; k < r.hours.length; k++) if (r.mask[k] === 1) sum += r.hours[k];
      return { sum, r };
    };
    const real = sunTotal(bare), old = sunTotal(rect);
    expect(real.sum).toBeGreaterThan(old.sum + 500); // far more open ground gets sun with the true shape
    // The courtyard is open ground in the real model and a building in the old one.
    const cell = (r: typeof real.r, x: number, y: number) => r.mask[Math.floor(y) * r.nx + Math.floor(x)];
    expect(cell(real.r, 41, 141)).toBe(1);
    expect(cell(old.r, 41, 141)).toBe(2);
    expect(cell(real.r, 16, 129)).toBe(1); // the yard notch
    // With the ficus back in, the notch is shaded in winter: the tree, not the building, is what darkens it.
    const withTree = sunTotal(site);
    const notchHours = (r: typeof real.r) => r.hours[Math.floor(129) * r.nx + 16];
    expect(notchHours(withTree.r)).toBeLessThan(notchHours(real.r) - 1);
  });
});

describe('the house from the owner\'s roof plan and four elevations', () => {
  const inch = 1 / 12;
  const parts = site.structures.filter((s) => s.group === 'house');
  const P = (id: string) => parts.find((s) => s.id === id)!;
  const main = P('house-main'), front = P('house-front'), porch = P('house-porch'), west = P('house-westwing'), rearA = P('house-rear-a'), rearB = P('house-rear-b');
  const garage = site.structures.find((s) => s.id === 'garage')!;
  const inPart = (x: number, y: number) => parts.some((p) => p.footprint[0][0] <= x && x <= p.footprint[2][0] && p.footprint[0][1] <= y && y <= p.footprint[2][1]);
  const area = (p: typeof main) => (p.footprint[2][0] - p.footprint[0][0]) * (p.footprint[2][1] - p.footprint[0][1]);
  const ridge = (p: typeof main) => roofPoints(p).filter((q) => q[2] === p.ridgeHeight);
  const TO_ROOF = 13 + 10.625 * inch; // T.O. ROOF on all four elevations

  it('is six existing parts that are always modeled, with the rear face where the plot plan puts it', () => {
    expect(parts.length).toBe(6);
    expect(parts.every((p) => p.status === 'existing' && !p.toggleable)).toBe(true);
    expect(activeStructures(site, { aduEnabled: false }).filter((s) => s.group === 'house').length).toBe(6);
    expect(rearB.footprint[2][1]).toBeCloseTo(123 + 4.375 * inch - (57 + 1.625 * inch), 3); // 123'-4 3/8" minus 57'-1 5/8"
    expect(checkPrintedDimensions(site, 1).find((c) => c.id === 'house-adu')!.ok).toBe(true);
  });

  it('is 41 ft deep, grid 1 to grid 5, as the east and west elevations space the grid lines', () => {
    const depth = rearB.footprint[2][1] - porch.footprint[0][1];
    expect(depth).toBeGreaterThan(41.0);
    expect(depth).toBeLessThan(41.4);
    // Grid 4 to 5 is the cut-out's 7'-9 1/4"; 3 to 4 is 17.0 ft, 2 to 3 is 12.1 ft, 1 to 2 is 4.4 ft.
    const y5 = rearB.footprint[2][1], y4 = rearB.footprint[0][1], y2 = main.footprint[0][1], y1 = porch.footprint[0][1];
    expect(y5 - y4).toBeCloseTo(7 + 9.25 * inch, 2);
    expect(Math.abs(y2 - (y1 + 4.36))).toBeLessThan(0.1); // the main gable's base is within a tenth of a foot of grid 2
    expect(Math.abs(y4 - y2 - (16.99 + 12.07))).toBeLessThan(0.1);
  });

  it('has the northwest cut-out: 7\'-7" in from the west and 7\'-9 1/4" deep', () => {
    expect(rearB.footprint[0][0] - west.footprint[0][0]).toBeCloseTo(7 + 7 * inch, 2);
    expect(rearB.footprint[2][1] - west.footprint[2][1]).toBeCloseTo(7 + 9.25 * inch, 2);
    expect(west.footprint[2][1]).toBeCloseTo(rearB.footprint[0][1], 6); // the wing's north wall is the rear wing's south edge
    expect(inPart(12, 62)).toBe(false); // the cut-out is open
    expect(inPart(12, 50)).toBe(true); // the west wing, just south of it
    expect(inPart(22, 62)).toBe(true); // the rear wing, east of it
    for (let y = 58.5; y < garage.footprint[0][1]; y += 1) expect(inPart(12, y)).toBe(false); // nothing between it and the garage
  });

  it('puts the side walls about 3.5 ft from the east lot line, and the house about 37 ft wide', () => {
    expect(site.lot.width - main.footprint[2][0]).toBeGreaterThan(3.2);
    expect(site.lot.width - main.footprint[2][0]).toBeLessThan(3.8);
    expect(main.footprint[2][0] - main.footprint[0][0]).toBeGreaterThan(36.8);
    expect(main.footprint[2][0] - main.footprint[0][0]).toBeLessThan(37.6);
  });

  it('tiles the footprint without overlap or gaps: about 1,474 sq ft', () => {
    const total = parts.reduce((a, p) => a + area(p), 0);
    const full = (main.footprint[2][0] - main.footprint[0][0]) * (rearB.footprint[0][1] - porch.footprint[0][1]); // the rectangle up to grid 4
    const rearNorth = (rearB.footprint[2][0] - rearB.footprint[0][0]) * (rearB.footprint[2][1] - rearB.footprint[0][1]);
    expect(total).toBeCloseTo(full + rearNorth, 1);
    expect(total).toBeGreaterThan(1460);
    expect(total).toBeLessThan(1490);
  });

  it('tops out at the elevations\' T.O. roof of 13\'-10 5/8", with the rear and west roofs lower as the north elevation shows', () => {
    expect(Math.max(...parts.map((p) => p.ridgeHeight))).toBeCloseTo(TO_ROOF, 3);
    expect(main.ridgeHeight).toBeCloseTo(TO_ROOF, 3);
    expect(front.ridgeHeight).toBeCloseTo(TO_ROOF, 3);
    expect(rearA.ridgeHeight).toBeCloseTo(11 + 2.875 * inch, 3); // spot elevation 11'-2 7/8"
    expect(rearB.ridgeHeight).toBeCloseTo(11 + 2.875 * inch, 3);
    expect(west.ridgeHeight).toBeCloseTo(11 + 5.75 * inch, 3); // spot elevation 11'-5 3/4"
    for (const p of parts) {
      expect(p.ridgeHeight).toBeGreaterThan(p.eaveHeight);
      expect(p.eaveHeight).toBeGreaterThan(8.5);
      expect(p.eaveHeight).toBeLessThan(10.5);
    }
    expect(2 * 1.25).toBeLessThan(3); // the ground floor sits 1'-3" above grade; the model's heights are all above grade
  });

  it('is a cross-gable: an east-west main ridge across the full width, and a north-south front gable that meets it', () => {
    const mr = ridge(main);
    expect(main.ridgeAxis).toBe('x');
    expect(mr.length).toBe(2);
    expect(mr[0][1]).toBeCloseTo(mr[1][1], 9); // straight, east to west
    expect(mr[0][1]).toBeGreaterThan(39.3); // apex 39.7 ft from the street
    expect(mr[0][1]).toBeLessThan(40.1);
    expect(Math.abs(mr[0][0] - mr[1][0])).toBeGreaterThan(37); // spans the whole house
    // Its gable end is 20.5 ft wide, as the east and west elevations show.
    const base = main.roofFootprint!;
    expect(base[2][1] - base[0][1]).toBeGreaterThan(20.2);
    expect(base[2][1] - base[0][1]).toBeLessThan(20.8);
    // The front gable's ridge runs north to south and ends on the main ridge.
    const fr = ridge(front);
    expect(front.ridgeAxis).toBe('y');
    expect(fr[0][0]).toBeCloseTo(fr[1][0], 9);
    expect(fr[0][0]).toBeGreaterThan(36.6); // about 37.1: centered between its eaves, and where the roof plan puts the ridge
    expect(fr[0][0]).toBeLessThan(37.6);
    expect(Math.max(fr[0][1], fr[1][1])).toBeCloseTo(mr[0][1], 3);
    expect(Math.min(fr[0][1], fr[1][1])).toBeLessThan(front.footprint[0][1]); // it reaches over the front wall
  });

  it('has roof pitches near 4 to 5 in 12 on the two big gables, as the gable ends show', () => {
    const pitch = (p: typeof main, half: number) => ((p.ridgeHeight - p.eaveHeight) / half) * 12;
    expect(pitch(main, (main.roofFootprint![2][1] - main.roofFootprint![0][1]) / 2)).toBeGreaterThan(3.4);
    expect(pitch(main, (main.roofFootprint![2][1] - main.roofFootprint![0][1]) / 2)).toBeLessThan(5.2);
    const fw = (front.roofFootprint![2][0] - front.roofFootprint![0][0]) / 2;
    expect(pitch(front, fw)).toBeGreaterThan(3.4);
    expect(pitch(front, fw)).toBeLessThan(5.2);
  });

  it('has a low shed porch roof falling south over the front door, below the main eave', () => {
    expect(porch.roofForm).toBe('shed');
    expect(porch.lowSide).toBe('south');
    expect(porch.eaveHeight).toBeLessThan(main.eaveHeight);
    const lowSouth = roofPoints(porch).filter((q) => q[2] === porch.eaveHeight && q[1] === Math.min(...porch.roofFootprint!.map((c) => c[1])));
    expect(lowSouth.length).toBeGreaterThanOrEqual(2);
    expect(ridge(porch).every((q) => q[1] === Math.max(...porch.roofFootprint!.map((c) => c[1])))).toBe(true); // only the north edge is high
  });

  it('runs the rear wing\'s ridge north to south at the same x through both halves, about 20 ft in from its west wall', () => {
    const a = ridge(rearA), b = ridge(rearB);
    expect(a[0][0]).toBeCloseTo(b[0][0], 9);
    expect(b[0][0] - rearB.footprint[0][0]).toBeGreaterThan(19.4);
    expect(b[0][0] - rearB.footprint[0][0]).toBeLessThan(20.6);
    expect(ridge(west)[0][0]).toBeGreaterThan(14.2); // the west gable's ridge, about 14.7
    expect(ridge(west)[0][0]).toBeLessThan(15.2);
  });

  it('keeps a ridge inside the roof even if the data puts it outside', () => {
    const odd = { ...front, ridgeAt: front.roofFootprint![2][0] + 50 };
    const r = roofPoints(odd).filter((q) => q[2] === odd.ridgeHeight);
    expect(r[0][0]).toBeLessThan(front.roofFootprint![2][0]);
    const centered = { ...front, ridgeAt: undefined };
    const c = roofPoints(centered).filter((q) => q[2] === centered.ridgeHeight);
    expect(c[0][0]).toBeCloseTo((front.roofFootprint![0][0] + front.roofFootprint![2][0]) / 2, 9);
  });

  it('lets sun reach the cut-out that a solid rectangle would have covered', () => {
    const bare = { ...site, contextObjects: [] };
    const solid = { ...bare, structures: [...bare.structures.filter((s) => s.group !== 'house'), { ...main, id: 'old', group: 'house', footprint: [[9.94, 25.04], [47.16, 25.04], [47.16, 66.23], [9.94, 66.23]] as [number, number][], roofFootprint: undefined, ridgeAt: undefined, ridgeAxis: 'y' as const }] };
    const run = (s: typeof site) => computeSunHours(buildSunScene(s, { aduEnabled: true }, engine), { period: { kind: 'day', month: 6, day: 21 }, year: 2026, config: engine.sun });
    const real = run(bare), old = run(solid);
    const k = (r: typeof real, x: number, y: number) => Math.floor(y) * r.nx + Math.floor(x);
    expect(real.mask[k(real, 12, 62)]).toBe(1);
    expect(old.mask[k(old, 12, 62)]).toBe(2);
    expect(real.hours[k(real, 12, 62)]).toBeGreaterThan(4); // open to the sky in June, apart from the house's own shade
  });

  it('casts a lower shadow than the old 15 ft placeholder roof', () => {
    const bare = { ...site, contextObjects: [] };
    const tall = { ...bare, structures: bare.structures.map((s) => (s.group === 'house' ? { ...s, ridgeHeight: s.ridgeHeight + 4, eaveHeight: s.eaveHeight + 4 } : s)) };
    const day = { kind: 'day' as const, month: 12, day: 21 };
    const total = (s: typeof site) => {
      const r = computeSunHours(buildSunScene(s, { aduEnabled: true }, engine), { period: day, year: 2026, config: engine.sun });
      let sum = 0;
      for (let k = 0; k < r.hours.length; k++) if (r.mask[k] === 1) sum += r.hours[k];
      return sum;
    };
    expect(total(bare)).toBeGreaterThan(total(tall) + 20); // the measured roof leaves more of the yard in winter sun
  });
});

describe('the garage from the owner\'s garage plan', () => {
  const garage = site.structures.find((s) => s.id === 'garage')!;
  const xs = (poly: [number, number][]) => poly.map((q) => q[0]);
  const ys = (poly: [number, number][]) => poly.map((q) => q[1]);
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);

  it('has walls 18\'-2" by 20\'-1" with the west wall 2\'-11" from the lot line', () => {
    expect(Math.min(...xs(garage.footprint))).toBeCloseTo(2 + 11 / 12, 3);
    expect(span(xs(garage.footprint))).toBeCloseTo(18 + 2 / 12, 3);
    expect(span(ys(garage.footprint))).toBeCloseTo(20 + 1 / 12, 3);
  });

  it('has a gable roof 22\'-1" front to back with a 1 ft overhang all round, ridge 12\'-8" running front to back', () => {
    const roof = garage.roofFootprint!;
    expect(span(ys(roof))).toBeCloseTo(22 + 1 / 12, 3);
    expect(span(xs(roof))).toBeCloseTo(20 + 2 / 12, 3);
    expect(Math.min(...xs(garage.footprint)) - Math.min(...xs(roof))).toBeCloseTo(1, 3);
    expect(Math.max(...ys(roof)) - Math.max(...ys(garage.footprint))).toBeCloseTo(1, 3);
    expect(garage.eaveHeight).toBe(8); // the lowest part of the garage
    expect(garage.ridgeHeight).toBe(12); // the top
    expect(siteRaw.openings.find((o: { id: string }) => o.id === 'garage-door')!.heightFt).toBe(7); // under the eave
    const pts = roofPoints(garage);
    const ridge = pts.filter((p) => p[2] === garage.ridgeHeight);
    expect(ridge).toHaveLength(2);
    expect(ridge[0][0]).toBeCloseTo(ridge[1][0], 6); // the ridge runs along Y
    expect(ridge[0][0]).toBeCloseTo((Math.min(...xs(roof)) + Math.max(...xs(roof))) / 2, 3); // at the middle
  });

  it('still sits 19\'-10 3/4" from the ADU, so the printed distance holds', () => {
    expect(checkPrintedDimensions(site, 1).find((c) => c.id === 'garage-adu')!.ok).toBe(true);
    expect(checkPrintedDimensions(site, 1).find((c) => c.id === 'garage-roof-depth')!.ok).toBe(true);
    expect(checkPrintedDimensions(site, 1).find((c) => c.id === 'garage-setback')!.ok).toBe(true);
  });

  it('has the driveway apron the plan shows: 16 ft wide for 10 ft, tapering to 26 ft from the garage front', () => {
    const drive = site.hardscape.find((h) => h.id === 'driveway')!;
    const front = Math.min(...ys(garage.footprint));
    const widthAt = (y: number) => {
      // widest horizontal run of the driveway outline at height y
      const hits: number[] = [];
      const pts = drive.points;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 - y) * (y2 - y) < 0) hits.push(x1 + ((x2 - x1) * (y - y1)) / (y2 - y1));
      }
      return Math.max(...hits) - Math.min(...hits);
    };
    expect(widthAt(front - 5)).toBeCloseTo(16, 3);
    expect(widthAt(front - 9.9)).toBeCloseTo(16, 1);
    expect(widthAt(front - 26 - 1)).toBeLessThan(9); // narrow again past the taper
    expect(widthAt(front - 18)).toBeGreaterThan(widthAt(front - 26));
    expect(widthAt(front - 18)).toBeLessThan(widthAt(front - 10.2));
    expect(Math.min(...xs(drive.points))).toBeCloseTo(1.25, 6); // starts 1'-3" in from the lot line
    expect(Math.max(...ys(drive.points))).toBeCloseTo(front, 6); // ends at the garage front wall
  });
});
