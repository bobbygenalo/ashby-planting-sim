import { distanceToPolygon, pointInPolygon } from './geometry';
import { footprint } from './hardscape';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, Pt, SiteConfig, Species, StructureCfg } from './types';
import type { ScenarioData } from './scenario';
import { lightSuits, roomRatio, shadesRaisedBed, type Neighbor, type SunMap } from './placement';

/** A small seeded random number generator, so a shuffle can be repeated from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShuffleOptions {
  /** Swap new plants for look-alike species (same kind, light, water and about the same size). */
  species: boolean;
  /** Nudge new plants a short way, keeping them off buildings and hard surfaces. */
  positions: boolean;
  /** Swap new hardscape for another material in the same family (for example pavers for flagstone). */
  materials: boolean;
  /** Give new hardscape a different color from its family's palette. */
  colors: boolean;
  /** Jump to a random year of growth and a random date and time of day. */
  time: boolean;
  /** Swap species only for ones starred in this scenario's palette. */
  starredOnly?: boolean;
}

export interface ShuffleContext {
  site: SiteConfig;
  structures: StructureCfg[];
  species: Species[];
  materials: Material[];
  engine: EngineConfig;
  /** Growing-season sun hours. When given, swaps and moves keep every plant in light it does well in. */
  sunMap?: SunMap;
}

export interface ShuffleChanges {
  species: number;
  moved: number;
  materials: number;
  colors: number;
}

export interface ShuffleResult {
  data: ScenarioData;
  /** The new view settings when time was shuffled. */
  time: { timelineMonth: number; doy: number; minutes: number } | null;
  changes: ShuffleChanges;
}

const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length)];

/** Species that could stand in for this one without changing what the plant needs. */
export function lookAlikes(sp: Species, all: Species[], band: [number, number]): Species[] {
  return all.filter(
    (o) =>
      o.id !== sp.id &&
      o.type === sp.type &&
      o.sun === sp.sun &&
      o.wucols === sp.wucols &&
      !o.invasive &&
      (!o.toxic || sp.toxic) &&
      o.matureHeight >= sp.matureHeight * band[0] && o.matureHeight <= sp.matureHeight * band[1] &&
      o.matureWidth >= sp.matureWidth * band[0] && o.matureWidth <= sp.matureWidth * band[1],
  );
}

/** Materials that could replace this one: same family and unit, never walls and fences. */
export function materialAlternatives(current: Material | undefined, all: Material[]): Material[] {
  if (!current || current.category === 'structure') return [];
  return all.filter((m) => m.id !== current.id && m.category === current.category && m.unit === current.unit);
}

/**
 * Explore variations of a scenario: new plants and new hardscape only (existing ones are facts about the yard
 * and stay put). Pure: the caller supplies the random generator.
 */
export function shuffleScenario(data: ScenarioData, ctx: ShuffleContext, opts: ShuffleOptions, rng: () => number): ShuffleResult {
  const cfg = ctx.engine.shuffle;
  const speciesById = new Map(ctx.species.map((s) => [s.id, s]));
  const matById = new Map(ctx.materials.map((m) => [m.id, m]));
  const changes: ShuffleChanges = { species: 0, moved: 0, materials: 0, colors: 0 };
  const pool = opts.starredOnly ? ctx.species.filter((s) => data.palette[s.id]) : ctx.species;

  const hardscape: HardscapeElement[] = data.hardscape.map((el) => {
    if (el.existing) return el;
    let next = el;
    if (opts.materials) {
      const alts = materialAlternatives(matById.get(el.materialId), ctx.materials);
      if (alts.length > 0) {
        const m = pick(rng, alts);
        next = { ...next, materialId: m.id, depthIn: m.defaultDepthIn, color: undefined };
        changes.materials++;
      }
    }
    if (opts.colors) {
      const category = matById.get(next.materialId)?.category;
      const palette = (category && cfg.colorsByCategory[category]) || [];
      const options = palette.filter((c) => c !== next.color);
      if (options.length > 0) {
        next = { ...next, color: pick(rng, options) };
        changes.colors++;
      }
    }
    return next;
  });

  const hardCover = hardscape
    .filter((el) => {
      const m = matById.get(el.materialId);
      return !el.removed && m && (m.permeability < cfg.hardCoverMaxPermeability || m.category === 'structure' || m.category === 'deck');
    })
    .map((el) => footprint(el, ctx.engine.hardscape))
    .filter((poly) => poly.length >= 3);
  const { width, depth } = ctx.site.lot;

  let instances: PlantInstance[] = data.instances.map((i) => ({ ...i }));
  const allowance = ctx.engine.concept.plants.overlapAllowance;
  const raisedBeds = hardscape.filter((el) => el.type === 'raisedBed' && !el.removed).map((el) => footprint(el, ctx.engine.hardscape));
  const neighbors = (except: number): Neighbor[] =>
    instances.flatMap((o, k) => {
      const osp = speciesById.get(o.speciesId);
      return k !== except && osp ? [{ position: o.position, species: osp }] : [];
    });
  // A plant stays where it suits: enough light, room to grow beside its neighbors, no tree canopy over a raised bed.
  // A spot that was already poor is not made worse.
  const suits = (sp: Species, p: Pt, index: number) =>
    lightSuits(sp, p, ctx.sunMap, ctx.engine) && roomRatio(sp, p, neighbors(index), allowance) >= 1 && !shadesRaisedBed(sp, p, raisedBeds);
  if (opts.species) {
    instances = instances.map((inst, index) => {
      if (inst.existing) return inst;
      const sp = speciesById.get(inst.speciesId);
      if (!sp) return inst;
      const wasFine = suits(sp, inst.position, index);
      const alts = lookAlikes(sp, pool, cfg.sizeRatioBand).filter((o) => !wasFine || suits(o, inst.position, index));
      if (alts.length === 0) return inst;
      changes.species++;
      const next = { ...inst, speciesId: pick(rng, alts).id };
      instances[index] = next;
      return next;
    });
  }
  if (opts.positions) {
    instances = instances.map((inst, index) => {
      if (inst.existing) return inst;
      const sp = speciesById.get(inst.speciesId);
      const nearest = (p: Pt) => Math.min(...ctx.structures.map((s) => distanceToPolygon(p[0], p[1], s.footprint)));
      // A plant keeps its roots as far from buildings as the species wants, or no closer than it already was.
      const clearance = Math.min(sp?.roots.minFoundationFt ?? 0, ctx.structures.length ? nearest(inst.position) : 0);
      const wasFine = sp ? suits(sp, inst.position, index) : true;
      for (let attempt = 0; attempt < cfg.moveAttempts; attempt++) {
        const angle = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * cfg.plantMoveRadiusFt;
        const p: Pt = [inst.position[0] + Math.cos(angle) * r, inst.position[1] + Math.sin(angle) * r];
        if (p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > depth) continue;
        if (ctx.structures.some((s) => pointInPolygon(p[0], p[1], s.footprint) || distanceToPolygon(p[0], p[1], s.footprint) < clearance - 1e-9)) continue;
        if (hardCover.some((poly) => pointInPolygon(p[0], p[1], poly))) continue;
        if (instances.some((o, k) => k !== index && Math.hypot(o.position[0] - p[0], o.position[1] - p[1]) < cfg.minPlantGapFt)) continue;
        if (sp && wasFine && !suits(sp, p, index)) continue;
        changes.moved++;
        const moved = { ...inst, position: [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))] as Pt };
        instances[index] = moved;
        return moved;
      }
      return inst;
    });
  }

  let time: ShuffleResult['time'] = null;
  if (opts.time) {
    const steps = Math.floor((cfg.sunMinutesTo - cfg.sunMinutesFrom) / cfg.sunMinutesStep);
    time = {
      timelineMonth: pick(rng, cfg.timeYearsFrom) * 12,
      doy: 1 + Math.floor(rng() * 365),
      minutes: cfg.sunMinutesFrom + Math.floor(rng() * (steps + 1)) * cfg.sunMinutesStep,
    };
  }

  return { data: { ...data, instances, hardscape }, time, changes };
}
