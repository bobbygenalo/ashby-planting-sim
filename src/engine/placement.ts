import { circleOverlapsPolygon } from './geometry';
import { sunFit } from './growth';
import { buildSunScene } from './site';
import { computeSunHours, type SunHoursResult } from './sunhours';
import type { EngineConfig, Pt, SiteConfig, Species } from './types';

/** Average growing-season sun hours across the lot, from the buildings alone (so a plant is not judged by its own shade). */
export interface SunMap {
  nx: number;
  ny: number;
  cellSize: number;
  hours: Float32Array;
  mask: Uint8Array;
}

export function sunMapFrom(r: SunHoursResult): SunMap {
  return { nx: r.nx, ny: r.ny, cellSize: r.cellSize, hours: r.hours, mask: r.mask };
}

/** Compute the growing-season sun map for a site. Takes a moment, so callers keep the result. */
export function buildSunMap(site: SiteConfig, aduEnabled: boolean, engine: EngineConfig): SunMap {
  const g = engine.sun.seasons.find((x) => x.id === 'growing')!;
  const scene = buildSunScene(site, { aduEnabled }, engine, []);
  return sunMapFrom(computeSunHours(scene, { period: { kind: 'range', from: g.from, to: g.to }, year: engine.referenceYear, config: engine.sun }));
}

export function sunHoursAt(map: SunMap, x: number, y: number): number {
  const i = Math.min(map.nx - 1, Math.max(0, Math.floor(x / map.cellSize)));
  const j = Math.min(map.ny - 1, Math.max(0, Math.floor(y / map.cellSize)));
  return map.hours[j * map.nx + i];
}

/** Does the spot give this species the light it does well in? Without a sun map nothing is ruled out. */
export function lightSuits(sp: Species, p: Pt, map: SunMap | undefined, engine: EngineConfig): boolean {
  return !map || sunFit(sp, sunHoursAt(map, p[0], p[1]), engine.growth) === 'ok';
}

export interface Neighbor {
  position: Pt;
  species: Species;
}

/**
 * How far from its nearest neighbor a plant stands, as a share of the room the two need at maturity (their mature
 * widths averaged, times the allowance). 1 or more means enough room. Groundcovers may run under taller plants.
 */
export function roomRatio(sp: Species, p: Pt, others: Neighbor[], allowance: number): number {
  let worst = Infinity;
  for (const o of others) {
    if ((o.species.type === 'groundcover') !== (sp.type === 'groundcover')) continue;
    const need = (allowance * (o.species.matureWidth + sp.matureWidth)) / 2;
    worst = Math.min(worst, Math.hypot(o.position[0] - p[0], o.position[1] - p[1]) / need);
  }
  return worst;
}

/** A tree at full size would spread over a raised bed. Beds belong in the open, not under a canopy that will shade them and drop fruit and leaves in them. */
export function shadesRaisedBed(sp: Species, p: Pt, beds: Pt[][]): boolean {
  return sp.type === 'tree' && beds.some((b) => circleOverlapsPolygon(p[0], p[1], sp.matureWidth / 2, b));
}
