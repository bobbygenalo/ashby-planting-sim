import { circleOverlapsPolygon, distanceToPolygon, lineToPolygon, pointInPolygon, polygonsIntersect } from './geometry';
import { drivewayBlocks, footprint } from './hardscape';
import { routePaths, type Hub } from './pathnet';
import { castsShade, compatible } from './companions';
import { lightSuits, roomRatio, shadesRaisedBed, type SunMap } from './placement';
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
  /** Growing-season sun hours across the lot. When given, plants go only where their light need is met. */
  sunMap?: SunMap;
}

export interface ConceptCounts {
  patio: number;
  table: number;
  grill: number;
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
  const counts: ConceptCounts = { patio: 0, table: 0, grill: 0, deck: 0, path: 0, beds: 0, raisedBeds: 0, lawn: 0, gravel: 0, mulch: 0, plants: 0, species: 0 };
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
  const doors = (ctx.site.doors ?? []).filter((d) => ctx.structures.some((st) => (st.group ?? st.id) === d.building));
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

  /**
   * Garden paths join the places people go. Early, before beds and plants take the room, they link the patio, every
   * door and any lawn or deck; late, once the plants are down, they reach the fruit trees people will harvest, joining
   * the paths already there.
   */
  const usedMaterials: string[] = [];
  const planPaths = (phase: 'early' | 'late', plants: PlantInstance[]) => {
    const pp = cfg.path;
    const half = pp.width / 2;
    const clear = half + pp.clearFt;
    const paths = placed.filter((e) => e.type === 'path');
    const areaPolys = placed.filter((e) => e.type !== 'path').map((e) => polyOf.get(e.id)!);
    const hubPolys = placed.filter((e) => ['patio', 'lawn', 'deck'].includes(e.type)).map((e) => ({ el: e, poly: polyOf.get(e.id)! }));
    const fixed = [...base.hardscape.filter((e) => !e.removed).map((e) => footprint(e, ctx.engine.hardscape)), ...ctx.site.easements.map((e) => e.polygon)];
    const discs = [
      ...trees.map((o) => ({ x: o.position![0], y: o.position![1], r: (o.canopyWidth ?? 10) / 2 + half })),
      ...plants.map((i) => {
        const sp = ctx.species.find((q) => q.id === i.speciesId)!;
        return { x: i.position[0], y: i.position[1], r: Math.min(sp.matureWidth / 2, pp.plantMaxRadiusFt) + half + 0.3 };
      }),
    ];
    let hubs: Hub[];
    if (phase === 'early') {
      hubs = [
        ...hubPolys.filter((h) => h.el.type === 'patio').map((h) => ({ id: h.el.id, label: 'the patio', polygon: h.poly })),
        ...doors.map((d) => ({ id: d.id, label: d.label.toLowerCase(), door: { point: d.point, outward: d.outward } })),
        // The front door's walk goes out to the street; the garage opens onto the driveway and needs none.
        ...doors.filter((d) => d.outward[1] < 0 && d.building === 'house').map((d) => ({ id: `street-${d.id}`, label: 'the street', door: { point: [d.point[0], 0] as Pt, outward: [0, 1] as Pt } })),
        ...hubPolys.filter((h) => h.el.type !== 'patio').map((h) => ({ id: h.el.id, label: h.el.name?.toLowerCase() ?? h.el.type, polygon: h.poly })),
      ];
    } else {
      const doorDist = (x: number, y: number) => Math.min(...doors.map((d) => Math.hypot(d.point[0] - x, d.point[1] - y)), Infinity);
      const fruiting = plants
        .map((i) => ({ i, sp: ctx.species.find((q) => q.id === i.speciesId)! }))
        .filter(({ sp }) => !!sp.fruit)
        .sort((a, b) => doorDist(a.i.position[0], a.i.position[1]) - doorDist(b.i.position[0], b.i.position[1]))
        .slice(0, pp.maxFruitHubs);
      hubs = fruiting.map(({ i, sp }) => {
        const stand = Math.min(sp.matureWidth / 2, pp.plantMaxRadiusFt) + pp.fruitStandFt;
        // The tree's own blocker is just wide enough to keep the path off the trunk.
        discs.find((q) => q.x === i.position[0] && q.y === i.position[1])!.r = stand + half + 0.2;
        return { id: i.id, label: `the ${sp.common.toLowerCase()}`, tree: { x: i.position[0], y: i.position[1], stand } };
      });
    }
    if (hubs.length === 0 || pp.max - paths.length <= 0) return;
    const hubPolyList = hubPolys.map((h) => h.poly);
    const net = routePaths({
      lot: ctx.site.lot, lotMarginFt: cfg.lotMarginFt, halfWidth: half, gridFt: pp.gridFt,
      blockers: [...ctx.structures.map((st) => ({ poly: st.footprint, clear })), ...[...fixed, ...areaPolys].map((poly) => ({ poly, clear }))],
      discs, hubs, maxPaths: pp.max - paths.length, reuse: pp.reuse, snap: ([x, y]) => [snap(x), snap(y)],
      seeds: paths.map((e) => e.points),
      accept: (line) => {
        const poly = lineToPolygon(line, pp.width);
        if (poly.some(([x, y]) => x < 0 || y < 0 || x > lotW || y > lotD)) return false;
        if (ctx.structures.some((st) => polygonsIntersect(poly, st.footprint))) return false;
        if (fixed.some((f) => polygonsIntersect(poly, f))) return false;
        return !areaPolys.some((a) => !hubPolyList.includes(a) && polygonsIntersect(poly, a));
      },
    });
    const label = (id: string) => hubs.find((h) => h.id === id)?.label;
    for (const route of net) {
      const choices = pp.materials.filter((m) => !usedMaterials.includes(m));
      const material = pick(rng, choices.length ? choices : pp.materials);
      usedMaterials.push(material);
      const to = route.to === 'path' ? 'the path' : label(route.to);
      add(make('path', route.points, `Path ${number('path')} to ${label(route.from)}${to ? ` and ${to}` : ''}, ${materialName(material)}`, material));
      counts.path++;
    }
  };

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
        add(make('patio', found[0].poly, 'Patio', paving.length ? pick(rng, paving).id : undefined));
        counts.patio = 1;
      } else notes.push('No room for a patio.');
    }

    // A communal table with its chairs and a grilling station, on the patio where there is room (the grill may stand
    // just beside it), the table toward the middle and the grill against the edge nearest a building.
    const patioEl = placed.find((el) => el.type === 'patio');
    if (patioEl) {
      const patio = polyOf.get(patioEl.id)!;
      const fc = cfg.furniture;
      const furniture = () => placed.filter((el) => el.type === 'table' || el.type === 'grill').map((el) => polyOf.get(el.id)!);
      const pxs = patio.map((p) => p[0]), pys = patio.map((p) => p[1]);
      const [px0, px1, py0, py1] = [Math.min(...pxs), Math.max(...pxs), Math.min(...pys), Math.max(...pys)];
      const pcx = (px0 + px1) / 2, pcy = (py0 + py1) / 2;
      const nearBuilding = (poly: Pt[]) => Math.min(...ctx.structures.map((st) => Math.min(...poly.map(([x, y]) => distanceToPolygon(x, y, st.footprint)))));
      const free = (poly: Pt[]) => {
        if (furniture().some((f) => polygonsIntersect(poly, f) || poly.some(([x, y]) => distanceToPolygon(x, y, f) < fc.gapFt) || f.some(([x, y]) => distanceToPolygon(x, y, poly) < fc.gapFt))) return false;
        return true;
      };
      const rects = (type: 'table' | 'grill', size: [number, number], within: 'patio' | 'outside') => {
        const out: Pt[][] = [];
        const tries = within === 'patio' ? fc.attempts : fc.grillOutsideAttempts;
        for (let i = 0; i < tries; i++) {
          const turn = rng() < 0.5;
          const [w, d] = turn ? [size[1], size[0]] : size;
          const poly = within === 'patio'
            ? rect(snap(px0 + fc.edgeFt + rng() * Math.max(0, px1 - px0 - w - 2 * fc.edgeFt)), snap(py0 + fc.edgeFt + rng() * Math.max(0, py1 - py0 - d - 2 * fc.edgeFt)), w, d)
            : rect(snap(px0 - w - 2 + rng() * (px1 - px0 + w + 4)), snap(py0 - d - 2 + rng() * (py1 - py0 + d + 4)), w, d);
          if (within === 'patio' ? poly.every(([x, y]) => pointInPolygon(x, y, patio) && ctx.structures.every((st) => distanceToPolygon(x, y, st.footprint) >= cfg.structureMarginFt)) : fits(poly, [cfg.patio.zone, ...cfg.plants.zones], 0, patio) && !polygonsIntersect(poly, patio) && poly.some(([x, y]) => distanceToPolygon(x, y, patio) < 1.5)) {
            if (free(poly)) out.push(poly);
          }
        }
        void type;
        return out;
      };
      const put = (type: 'table' | 'grill', poly: Pt[]) => {
        const label = cfg2.types[type].label;
        add(make(type, poly, label));
        counts[type] = 1;
      };
      const cfg2 = ctx.engine.hardscape;
      if (rng() < theme.table) {
        const spots = rects('table', cfg2.types.table.placeSize!, 'patio');
        // toward the middle of the patio
        spots.sort((a, b) => Math.hypot(a[0][0] + (a[2][0] - a[0][0]) / 2 - pcx, a[0][1] + (a[2][1] - a[0][1]) / 2 - pcy) - Math.hypot(b[0][0] + (b[2][0] - b[0][0]) / 2 - pcx, b[0][1] + (b[2][1] - b[0][1]) / 2 - pcy));
        if (spots.length) put('table', spots[0]);
        else notes.push('The patio is too small for a communal table.');
      }
      if (rng() < theme.grill) {
        let spots = rects('grill', cfg2.types.grill.placeSize!, 'patio');
        if (spots.length === 0) spots = rects('grill', cfg2.types.grill.placeSize!, 'outside');
        spots.sort((a, b) => nearBuilding(a) - nearBuilding(b));
        if (spots.length) put('grill', spots[0]);
        else notes.push('No room for a grilling station.');
      }
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
    planPaths('early', []);
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

    if (counts.beds + counts.raisedBeds + counts.mulch + counts.gravel === 0) notes.push('No room for beds.');
  }

  const planting = [...beds, ...raised, ...mulches, ...gravels];
  const keepOff = () => placed.filter((el) => ['patio', 'deck', 'path', 'lawn', 'table', 'grill'].includes(el.type)).map((el) => polyOf.get(el.id)!);
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
      // Everything a spot must satisfy for a species: inside a yard, clear of buildings, paving, the driveway, paths and doors, with
      // the light it needs, and room beside its neighbors (closer only for a purposeful or beautiful pairing).
      const neighborsAt = () => instances.map((o) => ({ position: o.position, species: ctx.species.find((q) => q.id === o.speciesId)! }));
      const spotOk = (sp: Species, p: Pt): boolean => {
      if (!insideYards(p[0], p[1])) return false;
      if (p[0] < cfg.lotMarginFt || p[1] < cfg.lotMarginFt || p[0] > lotW - cfg.lotMarginFt || p[1] > lotD - cfg.lotMarginFt) return false;
      if (ctx.structures.some((s) => pointInPolygon(p[0], p[1], s.footprint) || distanceToPolygon(p[0], p[1], s.footprint) < sp.roots.minFoundationFt)) return false;
      // Plants go in beds, gravel, mulch and open ground, not on paving, decks, paths or lawn.
      if (hard.some((poly) => pointInPolygon(p[0], p[1], poly))) return false;
      if (base.hardscape.some((e) => pointInPolygon(p[0], p[1], footprint(e, ctx.engine.hardscape)))) return false;
      // And nothing within a few feet of the driveway.
      if (drivewayBlocks(p, base.hardscape, ctx.engine.hardscape)) return false;
      if (ctx.site.easements.some((e) => pointInPolygon(p[0], p[1], e.polygon))) return false;
      if (trees.some((o) => Math.hypot(o.position![0] - p[0], o.position![1] - p[1]) < (o.canopyWidth ?? 10) / 2)) return false;
      if (placed.some((e) => e.type === 'path' && distanceToPolygon(p[0], p[1], polyOf.get(e.id)!) < cfg.path.plantEdgeFt)) return false;
      if (opts.hardscape && doors.some((d) => Math.hypot(d.point[0] - p[0], d.point[1] - p[1]) < cfg.path.doorKeepClearFt)) return false;
      // Light: a sun lover is not put in shade, nor a shade plant in full sun.
      if (!lightSuits(sp, p, ctx.sunMap, ctx.engine)) return false;
      // Room: neighbors keep their distance at mature size, and a tree's full canopy stays off raised beds.
      if (roomRatio(sp, p, neighborsAt(), pc.overlapAllowance, pc.companions) < 1) return false;
      if (shadesRaisedBed(sp, p, raised)) return false;
        return true;
      };
      const target_n = betweenInt(rng, pc.count);
      let treesPlaced = 0;
      for (let k = 0; k < target_n; k++) {
        const candidates = treesPlaced >= pc.maxTrees ? family.filter((s) => s.type !== 'tree') : family;
        if (candidates.length === 0) break;
        // A species that finds no spot with the light it needs and room to grow gives way to another draw.
        for (let tryNo = 0, done = false; tryNo < pc.speciesTries && !done; tryNo++) {
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
          if (!spotOk(sp, p)) continue;
          instances.push({
            id: `c-plant-${k}`, speciesId: sp.id, position: p, plantedMonth: 0,
            container: (sp.type === 'tree' ? pc.treeContainer : pc.container) as PlantInstance['container'], existing: false,
          });
          if (sp.type === 'tree') treesPlaced++;
          done = true;
          break;
        }
        }
      }
      // Purposeful closeness. Plants otherwise keep their crowns apart; these are the pairings that earn being close:
      // drifts of one small species (massed, so the planting reads as a whole), and low companions at the feet of trees and
      // big shrubs, in the shade or at the edge of the crown, never at the trunk.
      const comp = pc.companions;
      const speciesOf = (i: PlantInstance) => ctx.species.find((q) => q.id === i.speciesId)!;
      const around = (c: Pt, rMin: number, rMax: number): Pt => {
        const a = rng() * Math.PI * 2, r = between(rng, [rMin, rMax]);
        return [Number((c[0] + Math.cos(a) * r).toFixed(2)), Number((c[1] + Math.sin(a) * r).toFixed(2))];
      };
      let extra = 0;
      const anchors = instances.slice();
      for (const a of anchors) {
        const sp = speciesOf(a);
        // Fruiting plants stay single: each can be reached and picked, and a path can come to it.
        if (sp.type === 'tree' || sp.fruit || sp.matureWidth > comp.driftMaxWidthFt || rng() >= comp.driftChance) continue;
        const need = comp.driftSpacing * sp.matureWidth;
        for (let g = betweenInt(rng, comp.driftGroup) - 1, tries = 0; g > 0 && tries < 60 && instances.length < pc.maxTotal; tries++) {
          const p = around(a.position, need, need * 1.2);
          if (!spotOk(sp, p)) continue;
          instances.push({ id: `c-plant-d${extra++}`, speciesId: sp.id, position: p, plantedMonth: 0, container: pc.container as PlantInstance['container'], existing: false });
          g--;
        }
      }
      for (const a of anchors) {
        const tall = speciesOf(a);
        // Fruit trees keep clear ground beneath them, so the fruit can be picked and a path can come to the tree.
        if (tall.fruit || !(tall.type === 'tree' || (tall.matureWidth >= 5 && tall.matureHeight >= 4)) || rng() >= comp.understoryChance) continue;
        const lows = family.filter((s) => s.id !== tall.id && tall.matureHeight >= comp.layerHeightRatio * s.matureHeight && compatible(tall, s) && !(castsShade(tall, comp) && s.sun === 'full'));
        if (lows.length === 0) continue;
        const r = tall.matureWidth / 2;
        for (let want = betweenInt(rng, [1, comp.understoryMax]), tries = 0; want > 0 && tries < 80 && instances.length < pc.maxTotal; tries++) {
          const sp = draw(lows);
          const p = around(a.position, r * comp.coreFraction, r + sp.matureWidth * 0.25);
          if (!spotOk(sp, p)) continue;
          instances.push({ id: `c-plant-u${extra++}`, speciesId: sp.id, position: p, plantedMonth: 0, container: pc.container as PlantInstance['container'], existing: false });
          want--;
        }
      }
      counts.plants = instances.length;
      counts.species = new Set(instances.map((i) => i.speciesId)).size;
      if (instances.length === 0) notes.push('No room for plants.');
    }
  }

  if (opts.hardscape && theme) planPaths('late', instances);

  const hardscape = [...base.hardscape, ...placed];
  return { data: { ...base, palette: { ...ctx.palette }, hardscape, instances }, counts, theme: theme?.label ?? '', notes };
}
