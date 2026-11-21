import { convexHull, pointInConvex } from './geometry';
import { rasterizeSite, type SunScene } from './site';
import { solarPosition, sunVectorSite } from './solar';
import { dateRange, localToUtc } from './time';
import type { EngineConfig, Pt } from './types';

export type SunPeriod =
  | { kind: 'day'; month: number; day: number }
  | { kind: 'range'; from: [number, number]; to: [number, number] };

export type SunClass = 0 | 1 | 2 | 3; // shade, part shade, part sun, full sun

export interface SunHoursResult {
  nx: number;
  ny: number;
  cellSize: number;
  /** Average hours of direct sun per day, per cell (row-major, y from the street). */
  hours: Float32Array;
  /** 0 outside the lot, 1 open ground, 2 under a structure */
  mask: Uint8Array;
  zone: Uint8Array;
  zoneIds: string[];
  zoneNames: string[];
  daysSampled: number;
}

export function classify(hours: number, c: EngineConfig['sun']['classes']): SunClass {
  if (hours >= c.fullSunHours) return 3;
  if (hours >= c.partSunHours) return 2;
  if (hours >= c.partShadeHours) return 1;
  return 0;
}

interface Params {
  period: SunPeriod;
  year: number;
  config: EngineConfig['sun'];
}

/** Average hours of direct sun per cell over a day or a date range. Clear-sky geometry only. */
export function computeSunHours(scene: SunScene, params: Params): SunHoursResult {
  const { config } = params;
  const cell = config.cellSizeFt;
  const { nx, ny, mask, zone } = rasterizeSite(scene, cell);
  const hours = new Float32Array(nx * ny);
  const lit = new Float32Array(nx * ny);

  const dates: [number, number][] =
    params.period.kind === 'day'
      ? [[params.period.month, params.period.day]]
      : dateRange(params.period.from, params.period.to, config.sampleEveryDays);

  const step = config.stepMinutes;
  const dtHours = step / 60;

  for (const [month, day] of dates) {
    for (let minute = 0; minute < 1440; minute += step) {
      const utc = localToUtc(scene.timeZone, params.year, month, day, 0, minute + step / 2);
      const sun = solarPosition(utc, scene.latitude, scene.longitude, config.refraction);
      if (sun.elevationDeg < config.minElevationDeg) continue;
      const [sx, sy, sz] = sunVectorSite(scene.rearBearingDeg, scene.driveSide, sun.azimuthDeg, sun.elevationDeg);
      lit.fill(1);
      for (const solid of scene.solids) {
        const projected: Pt[] = solid.points.map(([x, y, z]) => [x - (z * sx) / sz, y - (z * sy) / sz]);
        const hull = convexHull(projected);
        if (hull.length < 3) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of hull) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        const i0 = Math.max(0, Math.floor(minX / cell));
        const i1 = Math.min(nx - 1, Math.floor(maxX / cell));
        const j0 = Math.max(0, Math.floor(minY / cell));
        const j1 = Math.min(ny - 1, Math.floor(maxY / cell));
        const density = solid.leafOffMonths?.includes(month) ? (solid.leafOffDensity ?? solid.density) : solid.density;
        const pass = 1 - density;
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * cell;
          for (let i = i0; i <= i1; i++) {
            if (pointInConvex((i + 0.5) * cell, y, hull)) lit[j * nx + i] *= pass;
          }
        }
      }
      for (let k = 0; k < lit.length; k++) hours[k] += lit[k] * dtHours;
    }
  }
  const n = Math.max(1, dates.length);
  for (let k = 0; k < hours.length; k++) hours[k] /= n;

  return {
    nx,
    ny,
    cellSize: cell,
    hours,
    mask,
    zone,
    zoneIds: scene.zones.map((z) => z.id),
    zoneNames: scene.zones.map((z) => z.name),
    daysSampled: dates.length,
  };
}

export interface ZoneSunStats {
  id: string;
  name: string;
  /** Open (non-structure) area in sq ft */
  area: number;
  meanHours: number;
  /** Area in sq ft by class: [shade, part shade, part sun, full sun] */
  classArea: [number, number, number, number];
}

/** Per-zone and whole-lot statistics. The last entry is the whole lot. */
export function zoneStats(result: SunHoursResult, classes: EngineConfig['sun']['classes']): ZoneSunStats[] {
  const cellArea = result.cellSize ** 2;
  const make = (id: string, name: string): ZoneSunStats => ({ id, name, area: 0, meanHours: 0, classArea: [0, 0, 0, 0] });
  const zones = result.zoneIds.map((id, i) => make(id, result.zoneNames[i]));
  const lot = make('lot', 'Whole lot');
  for (let k = 0; k < result.hours.length; k++) {
    if (result.mask[k] !== 1) continue;
    const h = result.hours[k];
    const c = classify(h, classes);
    const targets = [lot];
    if (result.zone[k] !== 255) targets.push(zones[result.zone[k]]);
    for (const t of targets) {
      t.area += cellArea;
      t.meanHours += h * cellArea;
      t.classArea[c] += cellArea;
    }
  }
  for (const t of [...zones, lot]) if (t.area > 0) t.meanHours /= t.area;
  return [...zones, lot];
}
