import { crownSections } from './canopy';
import type { Solid } from './site';
import type { EngineConfig, PlantInstance, Pt3, Species } from './types';

type GrowthCfg = EngineConfig['growth'];

const logistic = (t: number, T: number, k: number) => 1 / (1 + Math.exp(-k * (t - T / 2)));

/**
 * Size curve from the brief: S(t) = S0 + (Sm - S0) * (g(t) - g(0)) / (g(T) - g(0)),
 * g logistic with steepness k = steepness / T. Holds at Sm from T on.
 */
export function sizeAt(s0: number, sm: number, tYears: number, T: number, steepness: number): number {
  if (tYears <= 0) return s0;
  if (tYears >= T) return sm;
  const k = steepness / T;
  const g0 = logistic(0, T, k);
  const gT = logistic(T, T, k);
  return s0 + ((sm - s0) * (logistic(tYears, T, k) - g0)) / (gT - g0);
}

export interface PlantSize {
  planted: boolean;
  height: number;
  width: number;
}

/** Height and canopy width of an instance at a timeline month. */
export function instanceSize(inst: PlantInstance, sp: Species, timelineMonth: number, cfg: GrowthCfg): PlantSize {
  if (inst.existing) {
    return { planted: true, height: inst.currentHeight ?? sp.matureHeight, width: inst.currentWidth ?? sp.matureWidth };
  }
  const t = (timelineMonth - inst.plantedMonth) / 12;
  if (t < 0) return { planted: false, height: 0, width: 0 };
  const c = cfg.containers[inst.container];
  const h0 = Math.min(c.height, sp.matureHeight * cfg.maxStartFractionOfMature);
  const w0 = Math.min(c.width, sp.matureWidth * cfg.maxStartFractionOfMature);
  return {
    planted: true,
    height: sizeAt(h0, sp.matureHeight, t, sp.yearsToMaturity, cfg.steepness),
    width: sizeAt(w0, sp.matureWidth, t, sp.yearsToMaturity, cfg.steepness),
  };
}

/** Convex shadow body for a plant: a canopy ellipsoid on a clear trunk. */
export function plantSolid(inst: PlantInstance, sp: Species, size: PlantSize, cfg: GrowthCfg, rings: number): Solid | null {
  if (!size.planted || size.height < cfg.minShadowHeightFt) return null;
  const [cx, cy] = inst.position;
  const r = size.width / 2;
  const base = size.height * (cfg.trunkClearanceFraction[sp.type] ?? 0);
  const pts: Pt3[] = [];
  // The same crown the plant is drawn with, cut into sections, so the shade it casts matches what is seen.
  for (const [z, radius] of crownSections(sp.habit, r, base, size.height - base, cfg.shadowLevels, base <= 0.02, sp.crown?.profile)) {
    for (let i = 0; i < rings; i++) {
      const a = (i / rings) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z]);
    }
  }
  const density = crownDensity(sp, cfg);
  const deciduous = !sp.evergreen && sp.leafOffMonths.length > 0;
  return {
    id: `plant:${inst.id}`,
    points: pts,
    density,
    ...(deciduous ? { leafOffMonths: sp.leafOffMonths, leafOffDensity: sp.crown?.leafOffDensity ?? density * cfg.leafOffDensityFactor } : {}),
  };
}

/** Share of sunlight a plant's crown blocks in leaf: its own value, or its plant type's. Less light passes the denser it is. */
export function crownDensity(sp: Species, cfg: GrowthCfg): number {
  return sp.crown?.density ?? cfg.shadowDensityByType[sp.type] ?? 0.7;
}

export type SunFit = 'ok' | 'too-shaded' | 'too-sunny';

/** Compare growing-season sun hours with the species' light need (SUN-6). */
export function sunFit(sp: Species, hours: number, cfg: GrowthCfg): SunFit {
  const n = cfg.sunNeedHours;
  if (sp.sun === 'full') return hours < n.full.min ? 'too-shaded' : 'ok';
  if (sp.sun === 'part') return hours < n.part.min ? 'too-shaded' : hours > n.part.max ? 'too-sunny' : 'ok';
  return hours > n.shade.max ? 'too-sunny' : 'ok';
}

export interface PlacedPlant {
  inst: PlantInstance;
  species: Species;
  size: PlantSize;
}

/** Plants that exist at the timeline month, with their simulated size (PL-4, GR-2). The palette is only a shortlist and does not filter. */
export function placedPlants(
  instances: PlantInstance[],
  _palette: Record<string, boolean>,
  species: Species[],
  timelineMonth: number,
  cfg: GrowthCfg,
): PlacedPlant[] {
  const byId = new Map(species.map((s) => [s.id, s]));
  const out: PlacedPlant[] = [];
  for (const inst of instances) {
    const sp = byId.get(inst.speciesId);
    if (!sp) continue;
    const size = instanceSize(inst, sp, timelineMonth, cfg);
    if (size.planted) out.push({ inst, species: sp, size });
  }
  return out;
}

/** True when a deciduous species is leafless in this calendar month (GR-4). */
export function isLeafOff(sp: Species, month: number): boolean {
  return !sp.evergreen && sp.leafOffMonths.includes(month);
}

/** True when a species is in bloom in this calendar month (POL-7). */
export function isBlooming(sp: Species, month: number): boolean {
  return sp.bloomMonths.includes(month);
}
