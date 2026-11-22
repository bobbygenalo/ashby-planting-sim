import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import { inHolidaySeason, lightsAreOn, nthWeekday, roofLightLines, stringBulbs } from '../src/engine/holiday';
import { solarPosition } from '../src/engine/solar';
import { activeStructures, loadSite } from '../src/engine/site';
import { doyToMonthDay, localToUtc, monthDayToDoy } from '../src/engine/time';
import type { EngineConfig } from '../src/engine/types';
import { paintBulbs } from '../src/scene/holidayPaint';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.holiday;
const structures = activeStructures(site, { aduEnabled: true });
const part = (id: string) => structures.find((s) => s.id === id)!;

describe('the holiday season', () => {
  it('finds Thanksgiving, the fourth Thursday of November', () => {
    const t = cfg.thanksgiving;
    expect(nthWeekday(2026, t.month, t.weekday, t.nth)).toBe(26);
    expect(nthWeekday(2025, 11, 4, 4)).toBe(27);
    expect(nthWeekday(2024, 11, 4, 4)).toBe(28);
    expect(nthWeekday(2023, 11, 4, 4)).toBe(23);
    expect(new Date(Date.UTC(2026, 10, 26)).getUTCDay()).toBe(4);
  });

  it('starts the day after Thanksgiving and runs to the end of December', () => {
    const y = engine.referenceYear; // 2026: Thanksgiving was November 26
    expect(inHolidaySeason(11, 26, y, cfg)).toBe(false);
    expect(inHolidaySeason(11, 27, y, cfg)).toBe(true);
    expect(inHolidaySeason(11, 30, y, cfg)).toBe(true);
    expect(inHolidaySeason(12, 1, y, cfg)).toBe(true);
    expect(inHolidaySeason(12, 25, y, cfg)).toBe(true);
    expect(inHolidaySeason(12, 31, y, cfg)).toBe(true);
    expect(inHolidaySeason(1, 1, y, cfg)).toBe(false);
    expect(inHolidaySeason(10, 31, y, cfg)).toBe(false);
    expect(inHolidaySeason(6, 21, y, cfg)).toBe(false);
    // it follows the real Thanksgiving of the year
    expect(inHolidaySeason(11, 27, 2025, cfg)).toBe(false);
    expect(inHolidaySeason(11, 28, 2025, cfg)).toBe(true);
    // the whole year, by day number: only the stretch from late November
    const days = Array.from({ length: 365 }, (_, i) => i + 1).filter((d) => { const [m, dd] = doyToMonthDay(d); return inHolidaySeason(m, dd, y, cfg); });
    expect(days[0]).toBe(monthDayToDoy(11, 27));
    expect(days[days.length - 1]).toBe(365);
    expect(days).toHaveLength(365 - monthDayToDoy(11, 27) + 1);
  });
});

describe('when the lights are lit', () => {
  const at = (month: number, day: number, minutes: number) => {
    const utc = localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes);
    return solarPosition(utc, site.latitude, site.longitude, engine.sun.refraction).elevationDeg;
  };
  const lit = (month: number, day: number, minutes: number) => lightsAreOn(at(month, day, minutes), minutes, cfg);

  it('come on at sunset, stay on through the evening, and are off at midnight and all through the night and day', () => {
    expect(lit(12, 10, 12 * 60)).toBe(false); // noon
    expect(lit(12, 10, 16 * 60)).toBe(false); // the sun still up in the afternoon
    expect(lit(12, 10, 18 * 60)).toBe(true); // dark by six in December
    expect(lit(12, 10, 22 * 60)).toBe(true);
    expect(lit(12, 10, 23 * 60 + 59)).toBe(true);
    expect(lit(12, 11, 0)).toBe(false); // midnight: off
    expect(lit(12, 11, 3 * 60)).toBe(false);
    expect(lit(12, 11, 6 * 60)).toBe(false); // dark but after midnight
    expect(lit(12, 11, 9 * 60)).toBe(false);
  });

  it('switch on at the moment of sunset, which is earlier in December than in late November', () => {
    const firstOn = (month: number, day: number) => {
      for (let m = 12 * 60; m < 1440; m++) if (lit(month, day, m)) return m;
      return -1;
    };
    const dec = firstOn(12, 15), nov = firstOn(11, 30);
    expect(dec).toBeGreaterThan(16 * 60);
    expect(dec).toBeLessThan(18 * 60);
    expect(nov).toBeGreaterThan(16 * 60);
    expect(dec).toBeLessThanOrEqual(nov + 5);
    // just before it comes on the sun is above the cutoff, and just after it is below
    expect(at(12, 15, dec - 1)).toBeGreaterThan(cfg.sunsetElevationDeg);
    expect(at(12, 15, dec)).toBeLessThanOrEqual(cfg.sunsetElevationDeg);
  });
});

describe('the lights on the roofline', () => {
  it('follow the front gable of the street-facing house: two rakes and the eave', () => {
    const g = part('house-front');
    const lines = roofLightLines(g, cfg);
    expect(lines).toHaveLength(2);
    const [rakes, eave] = lines;
    expect(rakes).toHaveLength(3); // eave corner, apex, eave corner
    expect(rakes[1][2]).toBeCloseTo(g.ridgeHeight + cfg.liftFt, 6);
    expect(rakes[0][2]).toBeCloseTo(g.eaveHeight + cfg.liftFt, 6);
    expect(rakes[1][0]).toBeCloseTo(g.ridgeAt!, 6);
    expect(eave).toHaveLength(2);
    // all of it hangs just toward the street from the front of the roof, never behind it
    const frontY = Math.min(...(g.roofFootprint ?? g.footprint).map((p) => p[1]));
    for (const l of lines) for (const p of l) expect(p[1]).toBeCloseTo(frontY - cfg.outwardFt, 6);
  });

  it('follow the porch roof and the ADU roofs, climbing with the ADU\'s sloping front edge', () => {
    const porch = roofLightLines(part('house-porch'), cfg);
    expect(porch.length).toBe(3); // the eave and two side edges
    const adu = roofLightLines(part('adu-great'), cfg);
    expect(adu).toHaveLength(3); // the sloping front edge and a string down each side
    const [w, e] = adu[0];
    expect(w[0]).toBeLessThan(e[0]);
    expect(e[2]).toBeGreaterThan(w[2] + 2); // the shed roof rises to the east
    const bed = roofLightLines(part('adu-bedroom'), cfg);
    expect(bed[0][1][2]).toBeGreaterThan(bed[0][0][2]);
  });

  it('come down the vertical sides of the ADU awnings, from the roof edge to the ground, at the outer front corners', () => {
    for (const id of ['adu-great', 'adu-bedroom']) {
      const s = part(id);
      const [edge, ...sides] = roofLightLines(s, cfg);
      expect(sides).toHaveLength(2);
      const b = { minX: Math.min(...s.roofFootprint!.map((p) => p[0])), maxX: Math.max(...s.roofFootprint!.map((p) => p[0])) };
      expect(sides.map((l) => l[0][0]).sort((a, c) => a - c)).toEqual([b.minX, b.maxX]);
      for (const l of sides) {
        expect(l).toHaveLength(2);
        const [top, foot] = l;
        expect(top[0]).toBe(foot[0]);
        expect(top[1]).toBe(foot[1]); // straight down: a vertical line
        expect(foot[2]).toBeGreaterThan(0);
        expect(foot[2]).toBeLessThan(0.5); // down to the ground
        // it starts where the roof's front edge ends
        const end = l[0][0] === b.minX ? edge[0] : edge[1];
        expect(top).toEqual(end);
        expect(top[2]).toBeGreaterThan(s.eaveHeight);
      }
      // the east side is the taller one, since the roof climbs to the east
      expect(sides[1][0][2]).toBeGreaterThan(sides[0][0][2] + 1);
    }
    // the house keeps just its roofline: no strings down its walls
    for (const id of ['house-front', 'house-porch']) for (const l of roofLightLines(part(id), cfg)) expect(l.some((p) => p[2] < 5)).toBe(false);
  });

  it('are on the buildings the config names, and nowhere on the back of the house or the garage', () => {
    const lit = structures.filter((st) => cfg.lightedParts.includes(st.id));
    expect(lit.map((s) => s.id).sort()).toEqual(['adu-bedroom', 'adu-great', 'house-front', 'house-porch']);
    const lines = lit.flatMap((st) => roofLightLines(st, cfg));
    const houseY = Math.min(...structures.filter((s) => s.group === 'house').flatMap((s) => (s.roofFootprint ?? s.footprint).map((p) => p[1])));
    for (const l of lit.filter((s) => s.group === 'house').flatMap((st) => roofLightLines(st, cfg))) for (const p of l) expect(p[1]).toBeLessThan(houseY + 15.7);
    expect(lines.length).toBeGreaterThan(5);
    // with the ADU switched off, its lights go too
    const noAdu = activeStructures(site, { aduEnabled: false }).filter((st) => cfg.lightedParts.includes(st.id));
    expect(noAdu.every((s) => s.group === 'house')).toBe(true);
  });

  it('string bulbs along the lines at the spacing, ends included, in alternating colors', () => {
    const line: [number, number, number][] = [[0, 0, 0], [9, 0, 0]];
    const bulbs = stringBulbs([line], 0.9, 6);
    expect(bulbs).toHaveLength(11); // both ends and a bulb every 0.9 ft
    for (let i = 1; i < bulbs.length; i++) expect(Math.abs(bulbs[i].pos[0] - bulbs[i - 1].pos[0])).toBeCloseTo(0.9, 6);
    expect(bulbs[0].pos).toEqual([0, 0, 0]);
    expect(new Set(bulbs.map((b) => b.color)).size).toBe(6);
    for (let i = 1; i < bulbs.length; i++) expect(bulbs[i].color).not.toBe(bulbs[i - 1].color);
    // a bend does not bunch or gap them
    const bent = stringBulbs([[[0, 0, 0], [3, 0, 0], [3, 4, 0]]], 1, 3);
    for (let i = 1; i < bent.length; i++) expect(Math.hypot(bent[i].pos[0] - bent[i - 1].pos[0], bent[i].pos[1] - bent[i - 1].pos[1])).toBeLessThanOrEqual(1.0001);
    const sample = stringBulbs(roofLightLines(part('house-front'), cfg), cfg.bulbSpacingFt, cfg.colors.length);
    expect(sample.length).toBeGreaterThan(20);
  });
});

describe('painting the bulbs', () => {
  const lines = structures.filter((s) => cfg.lightedParts.includes(s.id)).flatMap((s) => roofLightLines(s, cfg));
  const list = stringBulbs(lines, cfg.bulbSpacingFt, cfg.colors.length);
  const make = () => ({
    bulbs: new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 4, 3), new THREE.MeshBasicMaterial(), list.length),
    glow: new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 4, 3), new THREE.MeshBasicMaterial(), list.length),
  });
  const colorAt = (m: THREE.InstancedMesh, i: number) => { const c = new THREE.Color(); m.getColorAt(i, c); return c; };

  it('gives every bulb its own color, many different ones, lit or not, never left white', () => {
    for (const lit of [true, false]) {
      const { bulbs, glow } = make();
      paintBulbs(bulbs, glow, list, cfg.colors, lit, cfg.offDim);
      expect(bulbs.count).toBe(list.length);
      const seen = new Set<string>();
      list.forEach((b, i) => {
        const want = new THREE.Color(cfg.colors[b.color]);
        if (!lit) want.multiplyScalar(cfg.offDim);
        const got = colorAt(bulbs, i);
        expect(got.r).toBeCloseTo(want.r, 5);
        expect(got.g).toBeCloseTo(want.g, 5);
        expect(got.b).toBeCloseTo(want.b, 5);
        seen.add(got.getHexString());
      });
      expect(seen.size).toBeGreaterThanOrEqual(5); // multicolor, not one color
      expect(glow.visible).toBe(lit);
    }
  });

  it('puts each bulb where the string is, and lights up the glow in the same colors', () => {
    const { bulbs, glow } = make();
    paintBulbs(bulbs, glow, list, cfg.colors, true, cfg.offDim);
    const m = new THREE.Matrix4();
    list.forEach((b, i) => {
      bulbs.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(b.pos[0], 5);
      expect(p.y).toBeCloseTo(b.pos[1], 5);
      expect(p.z).toBeCloseTo(b.pos[2], 5);
      expect(colorAt(glow, i).getHexString()).toBe(new THREE.Color(cfg.colors[b.color]).getHexString());
    });
  });

  it('repaints cleanly onto fresh meshes, as happens each time the date moves into the season', () => {
    const first = make();
    paintBulbs(first.bulbs, first.glow, list, cfg.colors, true, cfg.offDim);
    const fresh = make();
    paintBulbs(fresh.bulbs, fresh.glow, list, cfg.colors, true, cfg.offDim);
    list.forEach((_, i) => expect(colorAt(fresh.bulbs, i).getHexString()).toBe(colorAt(first.bulbs, i).getHexString()));
  });
});
