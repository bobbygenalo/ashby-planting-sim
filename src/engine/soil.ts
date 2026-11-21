import { pointInPolygon, polygonArea } from './geometry';
import type { PlacedPlant } from './growth';
import { buildCoverGrid, footprint } from './hardscape';
import type { ContainerId, EngineConfig, HardscapeElement, Material, SoilConfig, SoilProfile, Species, StructureCfg } from './types';

export type DrainageClass = 'fast' | 'moderate' | 'slow';

export function drainageClass(inPerHr: number, cfg: SoilConfig): DrainageClass {
  if (inPerHr >= cfg.drainageClasses.fastMinInHr) return 'fast';
  if (inPerHr >= cfg.drainageClasses.moderateMinInHr) return 'moderate';
  return 'slow';
}

const RANK: Record<DrainageClass, number> = { slow: 0, moderate: 1, fast: 2 };

/** Compare a species' soil preferences with a zone's profile and list mismatches (WS-11). */
export function soilMismatches(sp: Species, profile: SoilProfile, cfg: SoilConfig): string[] {
  const out: string[] = [];
  const need = sp.soil.drainageNeed;
  const have = drainageClass(profile.drainageInHr, cfg);
  if (need === 'fast' && RANK[have] < RANK.fast) {
    out.push(`${sp.common} needs fast drainage but this soil drains ${have} (${profile.drainageInHr} in/hr).`);
  } else if (need === 'moderate' && have === 'slow') {
    out.push(`${sp.common} needs at least moderate drainage but this soil drains slowly (${profile.drainageInHr} in/hr).`);
  }
  if (!sp.soil.textures.includes(profile.texture)) {
    out.push(`${sp.common} does not list ${profile.texture} soil as a good texture.`);
  }
  const tol = cfg.phTolerance;
  if (profile.ph < sp.soil.phMin - tol || profile.ph > sp.soil.phMax + tol) {
    out.push(`Soil pH ${profile.ph} is outside ${sp.common}'s range of ${sp.soil.phMin} to ${sp.soil.phMax}.`);
  }
  return out;
}

export interface Hole {
  widthIn: number;
  depthIn: number;
  volumeCuFt: number;
}

/** Planting hole from the container's root ball: a cylinder, wider than the ball, as deep as it (WS-12). */
export function plantingHole(container: ContainerId, cfg: SoilConfig): Hole {
  const ball = cfg.containers[container];
  const widthIn = ball.ballDiaIn * cfg.hole.widthFactor;
  const depthIn = ball.ballDepthIn * cfg.hole.depthFactor;
  const volumeCuFt = (Math.PI * (widthIn / 2) ** 2 * depthIn) / 1728;
  return { widthIn, depthIn, volumeCuFt };
}

const CU_FT_PER_CU_YD = 27;

export interface SoilQuantityRow {
  id: string;
  name: string;
  plants: number;
  areaSf: number;
  excavationCuYd: number;
  amendmentCuYd: number;
  mulchCuYd: number;
}

/**
 * Excavation, amendment and mulch volumes per bed and for the scenario (WS-12).
 * Plants are assigned to the bed (or raised bed) that contains them, otherwise to "Plants outside beds".
 * Existing plants are not planted, so they are excluded.
 */
export function soilQuantities(args: {
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  soil: SoilConfig;
  hardscapeCfg: EngineConfig['hardscape'];
}): { rows: SoilQuantityRow[]; total: SoilQuantityRow } {
  const { soil } = args;
  const beds = args.elements.filter((e) => !e.removed && (e.type === 'bed' || e.type === 'raisedBed'));
  const bedPolys = beds.map((e) => footprint(e, args.hardscapeCfg));
  const rows: SoilQuantityRow[] = beds.map((b, i) => ({
    id: b.id, name: b.name ?? (b.type === 'raisedBed' ? 'Raised bed' : 'Planting bed'), plants: 0,
    areaSf: polygonArea(bedPolys[i]), excavationCuYd: 0, amendmentCuYd: 0,
    mulchCuYd: (polygonArea(bedPolys[i]) * (soil.mulch.depthIn / 12)) / CU_FT_PER_CU_YD,
  }));
  const loose: SoilQuantityRow = { id: 'loose', name: 'Plants outside beds', plants: 0, areaSf: 0, excavationCuYd: 0, amendmentCuYd: 0, mulchCuYd: 0 };
  const ringArea = Math.PI * (soil.mulch.ringDiameterFt / 2) ** 2;

  for (const p of args.plants) {
    if (p.inst.existing) continue;
    const hole = plantingHole(p.inst.container, soil);
    const skip = soil.amendment.skipForDrainageNeed.includes(p.species.soil.drainageNeed);
    const exc = hole.volumeCuFt / CU_FT_PER_CU_YD;
    const amend = skip ? 0 : exc * soil.amendment.fractionOfBackfill;
    const bi = bedPolys.findIndex((poly) => pointInPolygon(p.inst.position[0], p.inst.position[1], poly));
    const row = bi >= 0 ? rows[bi] : loose;
    row.plants++;
    row.excavationCuYd += exc;
    row.amendmentCuYd += amend;
    if (bi < 0) {
      row.areaSf += ringArea;
      row.mulchCuYd += (ringArea * (soil.mulch.depthIn / 12)) / CU_FT_PER_CU_YD;
    }
  }
  const all = loose.plants > 0 ? [...rows, loose] : rows;
  const total = all.reduce<SoilQuantityRow>(
    (a, r) => ({ ...a, plants: a.plants + r.plants, areaSf: a.areaSf + r.areaSf, excavationCuYd: a.excavationCuYd + r.excavationCuYd, amendmentCuYd: a.amendmentCuYd + r.amendmentCuYd, mulchCuYd: a.mulchCuYd + r.mulchCuYd }),
    { id: 'total', name: 'Scenario total', plants: 0, areaSf: 0, excavationCuYd: 0, amendmentCuYd: 0, mulchCuYd: 0 },
  );
  return { rows: all, total };
}

/** Fill volume for raised beds: footprint x (height - freeboard) (WS-14). */
export function raisedBedFill(elements: HardscapeElement[], soil: SoilConfig, hardscapeCfg: EngineConfig['hardscape']): { id: string; name: string; areaSf: number; fillCuYd: number }[] {
  return elements
    .filter((e) => !e.removed && !e.existing && e.type === 'raisedBed')
    .map((e) => {
      const area = polygonArea(footprint(e, hardscapeCfg));
      const depthFt = Math.max(0, e.height - soil.raisedBed.freeboardIn / 12);
      return { id: e.id, name: e.name ?? 'Raised bed', areaSf: area, fillCuYd: (area * depthFt) / CU_FT_PER_CU_YD };
    });
}

export interface TreeSoilRow {
  id: string;
  name: string;
  matureCanopySf: number;
  requiredCuFt: number;
  availableCuFt: number;
  shortfallCuFt: number;
}

/**
 * Compare a target rootable soil volume (scaled to mature canopy area) with the open, unpaved soil
 * around each tree (WS-13). Soil under hardscape or structures does not count.
 */
export function treeSoilVolumes(args: {
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  materials: Material[];
  structures: StructureCfg[];
  lot: { width: number; depth: number };
  soil: SoilConfig;
  hardscapeCfg: EngineConfig['hardscape'];
}): TreeSoilRow[] {
  const { soil } = args;
  const grid = buildCoverGrid(args.elements, args.materials, args.structures, args.lot, args.hardscapeCfg);
  const out: TreeSoilRow[] = [];
  for (const p of args.plants) {
    if (p.species.type !== 'tree') continue;
    const R = p.species.matureWidth / 2;
    const matureCanopy = Math.PI * R * R;
    const required = soil.rootableSoil.cuFtPerSfCanopy * matureCanopy;
    const search = R * soil.rootableSoil.searchRadiusFactor;
    const [cx, cy] = p.inst.position;
    let openCells = 0;
    const i0 = Math.max(0, Math.floor((cx - search) / grid.cell)), i1 = Math.min(grid.nx - 1, Math.floor((cx + search) / grid.cell));
    const j0 = Math.max(0, Math.floor((cy - search) / grid.cell)), j1 = Math.min(grid.ny - 1, Math.floor((cy + search) / grid.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * grid.cell, y = (j + 0.5) * grid.cell;
        if (Math.hypot(x - cx, y - cy) <= search && grid.cls[j * grid.nx + i] === 0) openCells++;
      }
    }
    const available = openCells * grid.cell * grid.cell * soil.rootableSoil.depthFt;
    out.push({ id: p.inst.id, name: p.species.common, matureCanopySf: matureCanopy, requiredCuFt: required, availableCuFt: available, shortfallCuFt: Math.max(0, required - available) });
  }
  return out;
}
