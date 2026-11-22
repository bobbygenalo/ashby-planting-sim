import { circleOverlapsPolygon, distanceToPolygon, lineToPolygon, pointInPolygon, polygonsIntersect } from './geometry';
import { footprint } from './hardscape';
import type { ScenarioData } from './scenario';
import { emptyScenarioData } from './scenario';
import type { ConceptAreaCfg, EngineConfig, HardscapeElement, HardscapeType, Material, PlantInstance, Pt, SiteConfig, Species, StructureCfg } from './types';

export interface ConceptOptions {
  /** Generate paving, paths, lawn, gravel, mulch and beds. */
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

export interface ConceptCounts {
  patio: number;
  deck: number;
  path: number;
  beds: number;
  raisedBeds: number;
  lawn: number;
  gravel: number;
  mulch: number;
  plants: number;
  species: number;
}

export interface ConceptResult {
  data: ScenarioData;
  counts: ConceptCounts;
  /** The theme the concept was built around, for example "Dry garden". Empty when no hardscape was asked for. */
  theme: string;
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
 * A planting and hardscape concept built from nothing. A theme (lawn and beds, dry garden, kitchen garden, courtyard)
 * sets the mix: a patio, maybe a deck, a lawn, gravel and mulch areas, planting beds and raised beds, and one to three
 * garden paths, each in its own material and each with its own display color. Plants are then chosen from the palette (or
 * the whole library) and placed with room to grow. Existing items of the yard stay and are respected; nothing from any
 * other scenario is copied. Pure: the caller supplies the random generator.
 */
export function generateConcept(ctx: ConceptContext, opts: ConceptOptions, rng: () => number): ConceptResult {
  const cfg = ctx.engine.concept;
  const base = emptyScenarioData(ctx.site);
  const notes: string[] = [];
  const counts: ConceptCounts = { patio: 0, deck: 0, path: 0, beds: 0, raisedBeds: 0, lawn: 0, gravel: 0, mulch: 0, plants: 0, species: 0 };
  const matsById = new Map(ctx.materials.map((m) => [m.id, m]));
  const snap = (v: number) => Math.round(v / cfg.gridFt) * cfg.gridFt;
  const { width: lotW, depth: lotD } = ctx.site.lot;
  const zone = (id: string) => ctx.site.zones.find((z) => z.id === id);
  const theme = opts.hardscape ? pick(rng, cfg.themes) : null;

  const taken: Pt[][] = [
    ...base.hardscape.filter((e) => !e.removed).map((e) => footprint(e, ctx.engine.hardscape)),
    ...ctx.site.easements.map((e) => e.polygon),
  ];
  const trees = ctx.site.contextObjects.filter((o) => o.kind === 'tree' && o.position);
  const placed: HardscapeElement[] = [];
  const polyOf = new Map<string, Pt[]>();

  /** A candidate outline fits when it is inside its yard and the lot, clear of buildings, trees, easements and what is placed. */
  const fits = (poly: Pt[], zoneIds: string[], gap = 0, ignore?: Pt[]): boolean => {
    const zones = zoneIds.map(zone).filter((z): z is NonNullable<typeof z> => !!z);
    for (const [x, y] of poly) {
      if (x < cfg.lotMarginFt || y < cfg.lotMarginFt || x > lotW - cfg.lotMarginFt || y > lotD - cfg.lotMarginFt) return false;
      if (!zones.some((z) => pointInPolygon(x, y, z.polygon))) return false;
      for (const s of ctx.structures) {
        if (distanceToPolygon(x, y, s.footprint) < cfg.structureMarginFt || pointInPolygon(x, y, s.footprint)) return false;
      }
    }
    if (ctx.structures.some((s) => polygonsIntersect(poly, s.footprint))) return false;
    const others = ignore ? taken.filter((t) => t !== ignore) : taken;
    if (others.some((t) => polygonsIntersect(poly, t))) return false;
    if (gap > 0 && others.some((t) => poly.some(([x, y]) => distanceToPolygon(x, y, t) < gap && !pointInPolygon(x, y, t)))) return false;
    for (const o of trees) {
      if (circleOverlapsPolygon(o.position![0], o.position![1], (o.canopyWidth ?? 10) / 2, poly)) return false;
    }
    return true;
  };
  const number = (type: HardscapeType) => placed.filter((e) => e.type === type).length + 1;
  const make = (type: HardscapeType, points: Pt[], name: string, materialId?: string): HardscapeElement => {
    const t = ctx.engine.hardscape.types[type];
    const mat = matsById.get(materialId ?? t.material);
    const id = mat?.id ?? t.material;
    return {
      id: `c-${type}-${placed.length}`, type, name, points, materialId: id, height: t.height,
      depthIn: mat?.defaultDepthIn ?? t.depthIn, width: t.width, existing: false,
      // One color per material, so a lawn, a mulch zone, gravel and a patio can be told apart at a glance.
      ...(cfg.colors[id] ? { color: cfg.colors[id] } : {}),
    };
  };
  const add = (el: HardscapeElement) => {
    const poly = footprint(el, ctx.engine.hardscape);
    placed.push(el);
    taken.push(poly);
    polyOf.set(el.id, poly);
    return poly;
  };
  const materialName = (id: string) => matsById.get(id)?.name.toLowerCase() ?? id;

  /** Place a rectangle somewhere its area allows; returns its outline, or null when there is no room. */
  const placeArea = (area: ConceptAreaCfg, gap: number, swap = false): Pt[] | null => {
    for (let i = 0; i < area.attempts; i++) {
      const z = zone(pick(rng, area.zones));
      if (!z) continue;
      const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1]);
      const flip = swap && rng() < 0.5;
      const a = snap(between(rng, area.width)), b = snap(between(rng, area.depth));
      const w = flip ? b : a, d = flip ? a : b;
      if (Math.max(...xs) - Math.min(...xs) < w || Math.max(...ys) - Math.min(...ys) < d) continue;
      const x = snap(Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs) - w));
      const y = snap(Math.min(...ys) + rng() * (Math.max(...ys) - Math.min(...ys) - d));
      const poly = rect(x, y, w, d);
      if (fits(poly, [z.id], gap)) return poly;
    }
    return null;
  };

  const beds: Pt[][] = [];
  const raised: Pt[][] = [];
  const mulches: Pt[][] = [];
  const gravels: Pt[][] = [];
  let patioPoly: Pt[] | null = null;

  if (opts.hardscape && theme) {
    const gap = cfg.beds.gapFt;
    // Patio: the best of a few valid spots, meaning the one nearest the buildings.
    const pc = cfg.patio;
    const pz = zone(pc.zone);
    if (pz) {
      const xs = pz.polygon.map((p) => p[0]), ys = pz.polygon.map((p) => p[1]);
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
        const paving = ctx.materials.filter((m) => m.category === 'paving');
        patioPoly = add(make('patio', found[0].poly, 'Patio', paving.length ? pick(rng, paving).id : undefined));
        counts.patio = 1;
      } else notes.push('No room for a patio.');
    }

    // The big soft areas first, while there is room: lawn, then a deck, gravel and mulch.
    for (let n = 0, want = betweenInt(rng, theme.lawn); n < want; n++) {
      const poly = placeArea(cfg.areas.lawn, gap);
      if (!poly) break;
      add(make('lawn', poly, 'Lawn'));
      counts.lawn++;
    }
    if (rng() < theme.deck) {
      const poly = placeArea(cfg.areas.deck, gap);
      if (poly) {
        const mats = cfg.areas.deck.materials ?? [];
        add(make('deck', poly, 'Deck', mats.length ? pick(rng, mats) : undefined));
        counts.deck = 1;
      }
    }
    for (let n = 0, want = betweenInt(rng, theme.gravel); n < want; n++) {
      const poly = placeArea(cfg.areas.gravel, gap);
      if (!poly) break;
      add(make('gravel', poly, want > 1 ? `Gravel garden ${n + 1}` : 'Gravel garden', 'gravel'));
      gravels.push(poly);
      counts.gravel++;
    }
    for (let n = 0, want = betweenInt(rng, theme.mulch); n < want; n++) {
      const poly = placeArea(cfg.areas.mulch, gap);
      if (!poly) break;
      add(make('gravel', poly, 'Mulch zone', 'mulch'));
      mulches.push(poly);
      counts.mulch++;
    }

    // Planting beds, mostly along the edges of each yard, where beds usually go.
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
        add(make('bed', poly, `Planting bed ${number('bed')}`));
        beds.push(poly);
        made++;
        counts.beds++;
      }
    }

    // Raised beds: small, tidy, in either direction.
    for (let n = 0, want = betweenInt(rng, theme.raisedBeds); n < want; n++) {
      const poly = placeArea(cfg.areas.raisedBed, gap, true);
      if (!poly) break;
      add(make('raisedBed', poly, `Raised bed ${number('raisedBed')}`));
      raised.push(poly);
      counts.raisedBeds++;
    }

    // Garden paths leave the patio first, then other places, each a different material where it can be.
    const pp = cfg.path;
    const sources = (): Pt[][] => [...(patioPoly ? [patioPoly] : []), ...[...polyOf.values()].filter((p) => p !== patioPoly && !placed.some((e) => e.type === 'path' && polyOf.get(e.id) === p))];
    const wantPaths = Math.min(pp.max, betweenInt(rng, theme.paths));
    const usedMaterials: string[] = [];
    for (let n = 0; n < wantPaths; n++) {
      const from = n === 0 && patioPoly ? patioPoly : pick(rng, sources().length ? sources() : [patioPoly ?? rect(0, 0, 1, 1)]);
      const xs = from.map((p) => p[0]), ys = from.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (let i = 0; i < pp.attempts; i++) {
        const side = Math.floor(rng() * 4);
        const start: Pt = side === 0 ? [Math.min(...xs), cy] : side === 1 ? [Math.max(...xs), cy] : side === 2 ? [cx, Math.min(...ys)] : [cx, Math.max(...ys)];
        const angle = rng() * Math.PI * 2;
        const len = between(rng, pp.length);
        const mid: Pt = [snap(start[0] + Math.cos(angle) * len * 0.5), snap(start[1] + Math.sin(angle) * len * 0.5)];
        const end: Pt = [snap(mid[0] + Math.cos(angle + (rng() - 0.5)) * len * 0.5), snap(mid[1] + Math.sin(angle + (rng() - 0.5)) * len * 0.5)];
        const line: Pt[] = [[snap(start[0]), snap(start[1])], mid, end];
        // The first stretch starts on its source's edge, so only the rest has to avoid that.
        if (!fits(lineToPolygon(line, pp.width), ['back_yard', ...cfg.plants.zones], 0, from)) continue;
        if (polygonsIntersect(lineToPolygon(line.slice(1), pp.width), from)) continue;
        const choices = pp.materials.filter((m) => !usedMaterials.includes(m));
        const material = pick(rng, choices.length ? choices : pp.materials);
        usedMaterials.push(material);
        add(make('path', line, `Path ${number('path')}, ${materialName(material)}`, material));
        counts.path++;
        break;
      }
    }
    if (counts.beds + counts.raisedBeds + counts.mulch + counts.gravel === 0) notes.push('No room for beds.');
  }

  const planting = [...beds, ...raised, ...mulches, ...gravels];
  const keepOff = () => placed.filter((el) => ['patio', 'deck', 'path', 'lawn'].includes(el.type)).map((el) => polyOf.get(el.id)!);
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
      const hard = keepOff();
      const target_n = betweenInt(rng, pc.count);
      let treesPlaced = 0;
      for (let k = 0; k < target_n; k++) {
        const candidates = treesPlaced >= pc.maxTrees ? family.filter((s) => s.type !== 'tree') : family;
        if (candidates.length === 0) break;
        const sp = draw(candidates);
        for (let attempt = 0; attempt < pc.attempts; attempt++) {
          let p: Pt;
          if (planting.length > 0 && rng() < pc.bedBias) {
            const b = pick(rng, planting);
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
          // Plants go in beds, gravel, mulch and open ground, not on paving, decks, paths or lawn.
          if (hard.some((poly) => pointInPolygon(p[0], p[1], poly))) continue;
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
  return { data: { ...base, palette: { ...ctx.palette }, hardscape, instances }, counts, theme: theme?.label ?? '', notes };
}
