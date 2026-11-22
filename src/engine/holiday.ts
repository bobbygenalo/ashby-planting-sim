import { bbox } from './geometry';
import type { HolidayCfg, Pt3, StructureCfg } from './types';

/** The day of the month of the nth given weekday (1 Monday to 7 Sunday) in a month: the 4th Thursday of November is Thanksgiving. */
export function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() || 7; // 1 Monday to 7 Sunday
  return 1 + ((weekday - first + 7) % 7) + 7 * (nth - 1);
}

/** The lights are up from the day after Thanksgiving through the end of December. */
export function inHolidaySeason(month: number, day: number, year: number, cfg: HolidayCfg): boolean {
  const t = cfg.thanksgiving;
  return (month === t.month && day > nthWeekday(year, t.month, t.weekday, t.nth)) || (month > t.month && month <= cfg.seasonEndMonth);
}

/**
 * Lit from sunset until midnight. `minutes` is the minute of the local day, so the afternoon and evening count and the small
 * hours before dawn do not: at midnight the clock starts over and the lights are off.
 */
export function lightsAreOn(sunElevationDeg: number, minutes: number, cfg: HolidayCfg): boolean {
  return minutes >= 720 && sunElevationDeg <= cfg.sunsetElevationDeg;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The roofline of one structure's street-facing front as lines of 3D points, in site feet: a gable's two rakes and its
 * eave, a shed roof's front eave and its side edges, or the sloping front edge of the ADU's shed roofs. They hang a
 * little out from the edge toward the street (-Y) and a little above it, so the lights sit on the edge, not in it.
 */
export function roofLightLines(s: StructureCfg, cfg: Pick<HolidayCfg, 'outwardFt' | 'liftFt'>): Pt3[][] {
  const b = bbox(s.roofFootprint ?? s.footprint);
  const fb = bbox(s.footprint);
  const y0 = b.minY - cfg.outwardFt;
  const up = cfg.liftFt;
  const out: Pt3[][] = [];
  if (s.roofForm === 'gable') {
    if (s.ridgeAxis === 'x') return [[[b.minX, y0, s.eaveHeight + up], [b.maxX, y0, s.eaveHeight + up]]];
    const at = s.ridgeAt === undefined ? (b.minX + b.maxX) / 2 : Math.min(b.maxX - 0.25, Math.max(b.minX + 0.25, s.ridgeAt));
    const apex: Pt3 = [at, y0, s.ridgeHeight + up];
    out.push([[b.minX, y0, s.eaveHeight + up], apex, [b.maxX, y0, s.eaveHeight + up]]);
    out.push([[b.minX, y0, s.eaveHeight + up], [b.maxX, y0, s.eaveHeight + up]]);
    return out;
  }
  if (s.roofForm === 'shed') {
    const low = s.lowSide ?? 'west';
    if (low === 'south') {
      out.push([[b.minX, y0, s.eaveHeight + up], [b.maxX, y0, s.eaveHeight + up]]);
      for (const x of [b.minX, b.maxX]) out.push([[x, y0, s.eaveHeight + up], [x, b.maxY, s.ridgeHeight + up]]);
      return out;
    }
    if (low === 'west' || low === 'east') {
      // The front edge climbs from the low side to the high side along the roof plane.
      const z = (x: number) => {
        const t = (x - fb.minX) / (fb.maxX - fb.minX);
        return s.eaveHeight + (s.ridgeHeight - s.eaveHeight) * (low === 'east' ? 1 - t : t);
      };
      out.push([[b.minX, y0, z(b.minX) + up], [b.maxX, y0, z(b.maxX) + up]]);
      return out;
    }
  }
  return out;
}

export interface Bulb {
  pos: Pt3;
  /** Index into the color list, so neighbors differ. */
  color: number;
  /** A phase for the twinkle. */
  phase: number;
}

/** Bulbs strung along the lines every `spacing` feet, the first and last at the ends. */
export function stringBulbs(lines: Pt3[][], spacing: number, colors: number): Bulb[] {
  const out: Bulb[] = [];
  let n = 0;
  for (const line of lines) {
    let carried = 0;
    out.push({ pos: line[0], color: n % colors, phase: (n * 0.37) % 1 });
    n++;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      let at = spacing - carried;
      while (at <= len + 1e-9) {
        const t = len === 0 ? 0 : at / len;
        out.push({ pos: [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], color: n % colors, phase: (n * 0.37) % 1 });
        n++;
        at += spacing;
      }
      carried = len - (at - spacing);
    }
  }
  return out;
}
