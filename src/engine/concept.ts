import { circleOverlapsPolygon, distanceToPolygon, lineToPolygon, pointInPolygon, polygonsIntersect } from './geometry';
import { footprint } from './hardscape';
import type { ScenarioData } from './scenario';
import { emptyScenarioData } from './scenario';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, Pt, SiteConfig, Species, StructureCfg } from './types';

export interface ConceptOptions {
  /** Generate paving, paths and beds. */
  hardscape: boolean;
  /** Generate plants. */
  plants: boolean;
  /** Choose plants only from the scenario's starred palette. Otherwise from the whole library. */
  starredOnly: boolean;
}

export interface ConceptContext {
  site: SiteConfig;
  structures: StructureCfg[];
  species: Species[];
  materials: Material[];
  engine: EngineConfig;
  /** The scenario's starred palette. */
  palette: Record<string, boolean>;
}

export interface ConceptResult {
  data: ScenarioData;
  counts: { patio: number; path: number; beds: number; plants: number; species: number };
  /** Why part of the concept was left out, in plain words. */
  notes: string[];
}

const WATER_ORDER = ['very low', 'low', 'moderate', 'high'];
const between = (rng: () => number, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);
const betweenInt = (rng: () => number, [lo, hi]: [number, number]) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length)];

function rect(x: number, y: number, w: number, d: number): Pt[] {
  return [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
}

/**
 * A planting and hardscape concept built from nothing: a patio, a garden path and beds in free space, then plants
 * chosen from the palette (or the whole library) and placed with room to grow. Existing items of the yard stay and
 * are respected; nothing from any other scenario is copied. Pure: the caller supplies the random generator.
 */
export function generateConcept(ctx: ConceptContext, opts: ConceptOptions, rng: () => number): ConceptResult {
  const cfg = ctx.engine.concept;
  const base = emptyScenarioData(ctx.site);
  const notes: string[] = [];
  const counts = { patio: 0, path: 0, beds: 0, plants: 0, species: 0 };
  const matsById = new Map(ctx.materials.map((m) => [m.id, m]));
  const snap = (v: number) => Math.round(v / cfg.gridFt) * cfg.gridFt;
  const { width: lotW, depth: lotD } = ctx.site.lot;
  const zone = (id: string) => ctx.site.zones.find((z) => z.id === id);

  const taken: Pt[][] = [
    ...base.hardscape.filter((e) => !e.removed).map((e) => footprint(e, ctx.engine.hardscape)),
    ...ctx.site.easements.map((e) => e.polygon),
  ];
  const trees = ctx.site.contextObjects.filter((o) => o.kind === 'tree' && o.position);
  const placed: HardscapeElement[] = [];

  /** A candidate outline fits when it is inside its yard and the lot, clear of buildings, trees, easements and what is placed. */
  const fits = (poly: Pt[], zoneIds: string[], gap = 0): boolean => {
    const zones = zoneIds.map(zone).filter((z): z is NonNullable<typeof z> => !!z);
    for (const [x, y] of poly) {
      if (x < cfg.lotMarginFt || y < cfg.lotMarginFt || x > lotW - cfg.lotMarginFt || y > lotD - cfg.lotMarginFt) return false;
      if (!zones.some((z) => pointInPolygon(x, y, z.polygon))) return false;
      for (const s of ctx.structures) {
        if (distanceToPolygon(x, y, s.footprint) < cfg.structureMarginFt || pointInPolygon(x, y, s.footprint)) return false;
      }
    }
    if (ctx.structures.some((s) => polygonsIntersect(poly, s.footprint))) return false;
    if (taken.some((t) => polygonsIntersect(poly, t))) return false;
    if (gap > 0 && taken.some((t) => polygonsIntersect(poly, t) || poly.some(([x, y]) => distanceToPolygon(x, y, t) < gap && !pointInPolygon(x, y, t)))) return false;
    for (const o of trees) {
      if (circleOverlapsPolygon(o.position![0], o.position![1], (o.canopyWidth ?? 10) / 2, poly)) return false;
    }
    return true;
  };
  const add = (el: HardscapeElement) => {
    placed.push(el);
    taken.push(footprint(el, ctx.engine.hardscape));
  };
  const make = (type: HardscapeElement['type'], points: Pt[], materialId?: string): HardscapeElement => {
    const t = ctx.engine.hardscape.types[type];
    const mat = matsById.get(materialId ?? t.material);
    return {
      id: `c-${type}-${placed.length}`, type, points, materialId: mat?.id ?? t.material, height: t.height,
      depthIn: mat?.defaultDepthIn ?? t.depthIn, width: t.width, existing: false,
    };
  };

  let beds: Pt[][] = [];
  let patioPoly: Pt[] | null = null;

  if (opts.hardscape) {
    // Patio: the best of a few valid spots, meaning the one nearest the buildings.
    const pc = cfg.patio;
    const z = zone(pc.zone);
    if (z) {
      const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
      const found: { poly: Pt[]; near: number }[] = [];
      for (let i = 0; i < pc.attempts && found.length < pc.candidates; i++) {
        const w = snap(between(rng, pc.width)), d = snap(between(rng, pc.depth));
        const x = snap(Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs) - w));
        const y = snap(Math.min(...ys) + rng() * (Math.max(...ys) - Math.min(...ys) - d));
        const poly = rect(x, y, w, d);
        if (!fits(poly, [pc.zone])) continue;
        const near = Math.min(...ctx.structures.map((s) => Math.min(...poly.map(([px, py]) => distanceToPolygon(px, py, s.footprint)))));
        found.push({ poly, near });
      }
      if (found.length > 0) {
        found.sort((a, b) => a.near - b.near);
        patioPoly = found[0].poly;
        const paving = ctx.materials.filter((m) => m.category === 'paving');
        add(make('patio', patioPoly, paving.length ? pick(rng, paving).id : undefined));
        counts.patio = 1;
      } else notes.push('No room for a patio.');
    }

    // A garden path leaving the patio, bending once.
    if (patioPoly) {
      const pp = cfg.path;
      const xs = patioPoly.map((p) => p[0]), ys = patioPoly.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (let i = 0; i < pp.attempts; i++) {
        const side = Math.floor(rng() * 4);
        const start: Pt = side === 0 ? [Math.min(...xs), cy] : side === 1 ? [Math.max(...xs), cy] : side === 2 ? [cx, Math.min(...ys)] : [cx, Math.max(...ys)];
        const angle = rng() * Math.PI * 2;
        const len = between(rng, pp.length);
        const mid: Pt = [snap(start[0] + Math.cos(angle) * len * 0.5), snap(start[1] + Math.sin(angle) * len * 0.5)];
        const end: Pt = [snap(mid[0] + Math.cos(angle + (rng() - 0.5)) * len * 0.5), snap(mid[1] + Math.sin(angle + (rng() - 0.5)) * len * 0.5)];
        const line: Pt[] = [[snap(start[0]), snap(start[1])], mid, end];
        const poly = lineToPolygon(line, pp.width);
        // The first stretch starts on the patio edge, so only the rest has to avoid it.
        const saved = taken.pop();
        const ok = fits(poly, [ctx.engine.concept.patio.zone, ...cfg.plants.zones]);
        if (saved) taken.push(saved);
        if (!ok) continue;
        const rest = lineToPolygon(line.slice(1), pp.width);
        if (patioPoly && polygonsIntersect(rest, patioPoly)) continue;
        add(make('path', line));
        counts.path = 1;
        break;
      }
    }

    // Beds: mostly along the edges of each yard, where beds usually go.
    const bc = cfg.beds;
    for (const [zid, range] of Object.entries(bc.zones)) {
      const z = zone(zid);
      if (!z) continue;
      const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const want = betweenInt(rng, range);
      let made = 0;
      for (let i = 0; i < bc.attempts && made < want; i++) {
        const alongX = rng() < 0.5;
        const len = snap(between(rng, bc.length)), dep = snap(between(rng, bc.depth));
        const w = alongX ? len : dep, d = alongX ? dep : len;
        let x = snap(x0 + rng() * (x1 - x0 - w)), y = snap(y0 + rng() * (y1 - y0 - d));
        if (rng() < bc.edgeBias) {
          const edge = Math.floor(rng() * 4);
          if (edge === 0) x = x0 + cfg.lotMarginFt;
          if (edge === 1) x = x1 - w - cfg.lotMarginFt;
          if (edge === 2) y = y0 + cfg.lotMarginFt;
          if (edge === 3) y = y1 - d - cfg.lotMarginFt;
        }
        const poly = rect(snap(x), snap(y), w, d);
        if (!fits(poly, [zid], bc.gapFt)) continue;
        add(make('bed', poly));
        beds.push(poly);
        made++;
        counts.beds++;
      }
    }
    if (counts.beds === 0) notes.push('No room for beds.');
  }

  let instances: PlantInstance[] = [];
  if (opts.plants) {
    const pc = cfg.plants;
    const pool = ctx.species.filter((s) => !s.invasive && (!opts.starredOnly || ctx.palette[s.id]));
    if (pool.length < cfg.minPoolSize) {
      notes.push(opts.starredOnly ? `Star at least ${cfg.minPoolSize} plants to build a concept from your palette.` : 'Not enough plants in the library.');
    } else {
      // One water-use family per concept, so plants that share a bed share a hydrozone.
      const levels = [...new Set(pool.map((s) => WATER_ORDER.indexOf(s.wucols)))];
      const target = pick(rng, levels);
      const family = pool.filter((s) => Math.abs(WATER_ORDER.indexOf(s.wucols) - target) <= pc.waterSpread);
      const weight = (s: Species) => pc.pollinatorWeights[s.pollinator.value] ?? 1;
      const draw = (from: Species[]): Species => {
        const total = from.reduce((a, s) => a + weight(s), 0);
        let r = rng() * total;
        for (const s of from) {
          r -= weight(s);
          if (r <= 0) return s;
        }
        return from[from.length - 1];
      };
      const yardZones = pc.zones.map(zone).filter((z): z is NonNullable<typeof z> => !!z);
      const insideYards = (x: number, y: number) => yardZones.some((z) => pointInPolygon(x, y, z.polygon));
      const target_n = betweenInt(rng, pc.count);
      let treesPlaced = 0;
      for (let k = 0; k < target_n; k++) {
        const candidates = treesPlaced >= pc.maxTrees ? family.filter((s) => s.type !== 'tree') : family;
        if (candidates.length === 0) break;
        const sp = draw(candidates);
        for (let attempt = 0; attempt < pc.attempts; attempt++) {
          let p: Pt;
          if (beds.length > 0 && rng() < pc.bedBias) {
            const b = pick(rng, beds);
            const xs = b.map((q) => q[0]), ys = b.map((q) => q[1]);
            p = [between(rng, [Math.min(...xs) + 0.75, Math.max(...xs) - 0.75]), between(rng, [Math.min(...ys) + 0.75, Math.max(...ys) - 0.75])];
          } else {
            const z = pick(rng, yardZones);
            const xs = z.polygon.map((q) => q[0]), ys = z.polygon.map((q) => q[1]);
            p = [between(rng, [Math.min(...xs), Math.max(...xs)]), between(rng, [Math.min(...ys), Math.max(...ys)])];
          }
          p = [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))];
          if (!insideYards(p[0], p[1])) continue;
          if (p[0] < cfg.lotMarginFt || p[1] < cfg.lotMarginFt || p[0] > lotW - cfg.lotMarginFt || p[1] > lotD - cfg.lotMarginFt) continue;
          if (ctx.structures.some((s) => pointInPolygon(p[0], p[1], s.footprint) || distanceToPolygon(p[0], p[1], s.footprint) < sp.roots.minFoundationFt)) continue;
          // Plants go in beds and open ground, not on paving or paths.
          if (placed.some((el) => el.type !== 'bed' && pointInPolygon(p[0], p[1], footprint(el, ctx.engine.hardscape)))) continue;
          if (base.hardscape.some((e) => pointInPolygon(p[0], p[1], footprint(e, ctx.engine.hardscape)))) continue;
          if (ctx.site.easements.some((e) => pointInPolygon(p[0], p[1], e.polygon))) continue;
          if (trees.some((o) => Math.hypot(o.position![0] - p[0], o.position![1] - p[1]) < (o.canopyWidth ?? 10) / 2)) continue;
          const crowded = instances.some((o) => {
            const osp = ctx.species.find((s) => s.id === o.speciesId)!;
            // Groundcovers can run under taller plants; everything else needs room at maturity.
            if ((osp.type === 'groundcover') !== (sp.type === 'groundcover')) return false;
            return Math.hypot(o.position[0] - p[0], o.position[1] - p[1]) < pc.overlapAllowance * (osp.matureWidth + sp.matureWidth) / 2;
          });
          if (crowded) continue;
          instances.push({
            id: `c-plant-${k}`, speciesId: sp.id, position: p, plantedMonth: 0,
            container: (sp.type === 'tree' ? pc.treeContainer : pc.container) as PlantInstance['container'], existing: false,
          });
          if (sp.type === 'tree') treesPlaced++;
          break;
        }
      }
      counts.plants = instances.length;
      counts.species = new Set(instances.map((i) => i.speciesId)).size;
      if (instances.length === 0) notes.push('No room for plants.');
    }
  }

  const hardscape = [...base.hardscape, ...placed];
  return { data: { ...base, palette: { ...ctx.palette }, hardscape, instances }, counts, notes };
}
