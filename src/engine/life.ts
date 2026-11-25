import { distanceToPolygon, pointInPolygon } from './geometry';
import { footprint } from './hardscape';
import { worldSeats, type WorldSeat } from './furniture';
import { cakeOn, partyOn, type BirthdayDay } from './birthday';
import { litterState } from './litter';
import { sunHoursAt, type SunMap } from './placement';
import { isBlooming, type PlacedPlant } from './growth';
import { mulberry32 } from './shuffle';
import { skyWatchSpots } from './fireworks';
import { fruitState } from './fruit';
import { bodyOf, stepLengthFt } from './anatomy';
import { beamTriangle, castOnWall, coverage, dogSpheres, inBeam, personSpheres, type Disc } from './projector';
import { ageGroup, approach, fiveArm, greeting, headTurnToward, lingerOptions, paceMultiplier, personalityOf, pickWeighted, weaveOffset, type LingerKind, type Personality } from './manner';
import type { SedanSpot } from './vehicle';
import engineData from '../data/engine.json';
import type { AnatomyCfg, EngineConfig, HardscapeElement, Material, Pt, SiteConfig, StructureCfg } from './types';

/** The body proportions from engine.json, for a sim built without being handed any. */
const defaultAnatomy = (engineData as unknown as { anatomy: AnatomyCfg }).anatomy;

type Cfg = EngineConfig['life'];

/** Under this age a child follows an adult. */
export const TODDLER_AGE_LIMIT = 6;
/** From this age a person is an adult. */
export const ADULT_AGE = 18;

/** A flower the bees can visit: where it is, how wide, and how high its top is. */
export interface Bloom {
  x: number;
  y: number;
  radius: number;
  height: number;
}

/** The yard as the walkers and the bees see it. */
/** A blooming plant, for the hummingbirds and butterflies: where, how big, which visitors it draws, and how much sun it gets. */
export interface Flower {
  x: number;
  y: number;
  radius: number;
  height: number;
  groups: string[];
  /** Growing-season sun hours a day where it stands, or null when no sun map was given. */
  sun: number | null;
}

/** A place a worm might come up: in soil, mulch or under a bed, more likely in shade, under fallen leaves and under compost. */
export interface WormSpot {
  x: number;
  y: number;
  /** Planting bed or mulch: richer ground. */
  rich: boolean;
  litter: 'none' | 'fresh' | 'compost';
  shade: boolean;
}

/** A plant with fruit or berries ready for the birds this month. */
export interface BirdFood {
  x: number;
  y: number;
  radius: number;
  height: number;
}

/** A plant with ripe fruit now that a person can pick: where it stands, how big it is, and what its fruit looks like. */
export interface HarvestPlant {
  id: string;
  speciesId: string;
  common: string;
  x: number;
  y: number;
  radius: number;
  height: number;
  color: string;
  /** How big a piece looks on the plant, in feet. */
  diameterFt: number;
  /** How big a piece really is, in feet: this sets how much fits in a basket. */
  pieceFt: number;
  aspect: number;
}

/** A building's footprint and its highest point, so anything flying can be kept out of it. */
export interface StructureTop {
  poly: Pt[];
  top: number;
}

export interface LifeWorld {
  lot: { width: number; depth: number };
  nx: number;
  ny: number;
  cell: number;
  /** The cheapest cost per foot of any ground, for the route finder's estimate. */
  minCost: number;
  /** 1 where nobody can stand: plants, buildings, raised beds, walls, fences, the lot edge and the hive. */
  blocked: Uint8Array;
  /** Cost of crossing each cell. Paths are the cheapest ground. */
  cost: Float32Array;
  /** 1 on a garden path. */
  isPath: Uint8Array;
  /** Cells that can be reached from one another; the largest connected part of the open ground. */
  reachable: number[];
  pathCells: number[];
  plants: { x: number; y: number; r: number }[];
  structures: Pt[][];
  blooms: Bloom[];
  hive: { x: number; y: number } | null;
  /** Doors people can go in and out of, for the buildings that are in the plan. */
  doors: LifeDoor[];
  /** Tables people can sit down at, with their reachable seats. */
  tables: LifeTable[];
  /** The wall the evening movie is shown on, or null when the plan has no such wall or no room to watch from. */
  screen: LifeScreen | null;
  /** Calendar month the world was built for (1 to 12). */
  month: number;
  flowers: Flower[];
  /** Tops of plants a hummingbird can sit on. */
  perches: { x: number; y: number; z: number; r: number }[];
  wormSpots: WormSpot[];
  /** Plants with ripe fruit or berries now, which fruit-eating birds come for. */
  birdFood: BirdFood[];
  /** Plants with ripe fruit now that people pick into baskets. */
  harvest: HarvestPlant[];
  /** Buildings: footprints and roof heights, for wildlife that flies over them and never through them. */
  structureTops: StructureTop[];
  /** Open, reachable ground in the party yard (the back yard), where people gather on a birthday. */
  partyCells: number[];
  /** Open ground to stand on and watch the fireworks over the back of the lot, spread out. */
  skySpots: Pt[];
  /** Ground the projector's beam crosses (with a margin), as 1s, while a screen exists; and the extra route cost of crossing it, which the sim turns on only while a film shows. */
  beamCells: Uint8Array | null;
  beamCost: Float32Array | null;
  /** Set by the sim while a film shows: routes then pay `beamCost` for crossing the beam. */
  beamOn: boolean;
  /** Places to perch on the rim of a raised bed: where the hips rest, which way a sitter faces (away from the bed), the open ground just outside, and the rim's height. */
  rims: Rim[];
  /** Raised flat ground (the porch floor, the stoop, a landing): where a walker's feet stand higher than the lot. */
  raised: { poly: Pt[]; top: number }[];
}

export interface Rim {
  x: number;
  y: number;
  face: number;
  out: Pt;
  z: number;
}

export interface LifeTable {
  id: string;
  center: Pt;
  seats: WorldSeat[];
}

export interface LifeScreen {
  /** The wall's east face: X of the screen, and the Y of its middle. */
  x: number;
  y: number;
  width: number;
  bottom: number;
  height: number;
  /** Open ground to watch from, in front of the screen. */
  spots: Pt[];
  /** Where the projector stands, behind the viewers. */
  projector: Pt;
  /** The lens: x, y and height, in site coordinates. */
  lens: [number, number, number];
}

/** A door: where someone stands to go in, and the open ground a little way out where they walk to first. */
export interface LifeDoor {
  id: string;
  label: string;
  building: string;
  /** Just outside the wall, where they step in and out of sight. */
  stand: Pt;
  approach: Pt;
  /** The drawn door that opens for people going through it. */
  opening?: string;
}

export interface LifeWorldInput {
  site: SiteConfig;
  structures: StructureCfg[];
  hardscape: HardscapeElement[];
  materials: Material[];
  plants: PlacedPlant[];
  /** Calendar month (1 to 12), for which plants are in bloom. */
  month: number;
  engine: EngineConfig;
  /** Keep the hive where it was when it is still a good spot. */
  hive?: { x: number; y: number } | null;
  /** Where the owner put the hive: used as it is, a good spot or not. */
  hiveAt?: { x: number; y: number } | null;
  /** Growing-season sun hours across the lot; butterflies keep to sunny flowers and worms to shade when it is given. */
  sunMap?: SunMap;
  /** The white sedan on the driveway, when it is home: nobody walks through it. */
  sedan?: SedanSpot | null;
}

const idx = (w: { nx: number }, i: number, j: number) => j * w.nx + i;
const center = (w: { cell: number }, i: number, j: number): Pt => [(i + 0.5) * w.cell, (j + 0.5) * w.cell];
const cellOf = (w: { cell: number; nx: number; ny: number }, x: number, y: number): [number, number] => [
  Math.min(w.nx - 1, Math.max(0, Math.floor(x / w.cell))),
  Math.min(w.ny - 1, Math.max(0, Math.floor(y / w.cell))),
];

/** Walkable ground, its cost, and where the bees can feed. */
export function buildLifeWorld(input: LifeWorldInput): LifeWorld {
  const cfg = input.engine.life;
  const { width, depth } = input.site.lot;
  const nx = Math.ceil(width / cfg.cellFt), ny = Math.ceil(depth / cfg.cellFt);
  const blocked = new Uint8Array(nx * ny);
  const cost = new Float32Array(nx * ny).fill(cfg.costs.open);
  const isPath = new Uint8Array(nx * ny);
  const w: LifeWorld = {
    lot: { width, depth }, nx, ny, cell: cfg.cellFt, minCost: Math.min(...Object.values(cfg.costs)), blocked, cost, isPath, reachable: [], pathCells: [],
    plants: [], structures: input.structures.filter((s) => !s.open).map((s) => s.footprint), blooms: [], hive: null, doors: [], tables: [], screen: null, month: input.month, flowers: [], perches: [], wormSpots: [], birdFood: [], harvest: [], structureTops: input.structures.map((st) => ({ poly: st.footprint, top: Math.max(st.ridgeHeight, st.eaveHeight) })), partyCells: [], skySpots: [], rims: [], raised: [], beamCells: null, beamCost: null, beamOn: false,
  };

  // Ground, in the order the plan draws it, so what is on top decides what a cell is.
  const mats = new Map(input.materials.map((m) => [m.id, m]));
  const order = input.engine.hardscape.drawOrder;
  const els = input.hardscape.filter((e) => !e.removed).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const classes = els.map((el) => ({ el, poly: footprint(el, input.engine.hardscape) })).filter((c) => c.poly.length >= 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, y] = center(w, i, j);
      const k = idx(w, i, j);
      for (const { el, poly } of classes) {
        if (!pointInPolygon(x, y, poly)) continue;
        const material = mats.get(el.materialId);
        if (el.type === 'raisedBed' || el.type === 'wall' || el.type === 'fence' || el.type === 'table' || el.type === 'grill') blocked[k] = 1;
        else if (el.type === 'path') {
          cost[k] = cfg.costs.path;
          isPath[k] = 1;
        } else if (el.type === 'patio' || el.type === 'deck') {
          cost[k] = cfg.costs.hard;
          isPath[k] = 0;
        } else if (el.type === 'lawn') cost[k] = cfg.costs.lawn;
        else if (el.type === 'bed') cost[k] = cfg.costs.bed;
        else if (el.type === 'gravel') cost[k] = el.materialId === 'mulch' || material?.id === 'mulch' ? cfg.costs.mulch : cfg.costs.gravel;
        if (el.type !== 'path') isPath[k] = 0;
      }
    }
  }

  // An open porch can be walked on, but its slat screen and posts cannot be walked through: each is a thin box.
  const screens: Pt[][] = (input.site.contextObjects ?? []).flatMap((o): Pt[][] => {
    if (o.kind === 'screen' && o.line && o.line.length > 1) {
      const out: Pt[][] = [];
      const t = Math.max(o.thickness ?? 0.3, o.endPostFt ?? 0.3) / 2;
      for (let i = 0; i + 1 < o.line.length; i++) {
        const [x1, y1] = o.line[i], [x2, y2] = o.line[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx2 = (-(y2 - y1) / len) * t, ny2 = ((x2 - x1) / len) * t;
        out.push([[x1 + nx2, y1 + ny2], [x2 + nx2, y2 + ny2], [x2 - nx2, y2 - ny2], [x1 - nx2, y1 - ny2]]);
      }
      return out;
    }
    if (o.kind === 'post' && o.position) {
      const [x, y] = o.position, h = (o.postFt ?? 0.4) / 2;
      return [[[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]]];
    }
    return [];
  });
  // Buildings, the lot edge, and every plant's canopy are off limits.
  for (const p of input.plants) {
    if (!p.size.planted) continue;
    w.plants.push({ x: p.inst.position[0], y: p.inst.position[1], r: Math.max(p.size.width / 2, 0.3) });
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, y] = center(w, i, j);
      const k = idx(w, i, j);
      if (x < cfg.margins.lotFt || y < cfg.margins.lotFt || x > width - cfg.margins.lotFt || y > depth - cfg.margins.lotFt) blocked[k] = 1;
      if (!blocked[k] && w.structures.some((s) => pointInPolygon(x, y, s) || distanceToPolygon(x, y, s) < cfg.margins.structureFt)) blocked[k] = 1;
      if (!blocked[k] && screens.some((s) => pointInPolygon(x, y, s) || distanceToPolygon(x, y, s) < cfg.margins.structureFt)) blocked[k] = 1;
      if (!blocked[k] && w.plants.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + cfg.margins.plantFt)) blocked[k] = 1;
      if (!blocked[k] && input.sedan && (pointInPolygon(x, y, input.sedan.poly) || distanceToPolygon(x, y, input.sedan.poly) < input.engine.vehicle.marginFt)) blocked[k] = 1;
    }
  }
  w.blooms = input.plants
    .filter((p) => p.size.planted && isBlooming(p.species, input.month) && p.species.pollinator.groups.some((g) => g === 'honey bees' || g === 'native bees'))
    .map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], radius: Math.max(p.size.width / 2, 0.3), height: Math.max(p.size.height, 0.3) }));
  // Ripe fruit people can pick: the same state the fruit is drawn from, so what is picked is what is shown.
  w.harvest = [];
  for (const p of input.plants) {
    const fs = fruitState(p.species, p.size, input.month, input.engine.fruit);
    if (fs?.phase === 'ripe' && fs.count >= 3) {
      w.harvest.push({ id: p.inst.id, speciesId: p.species.id, common: p.species.common, x: p.inst.position[0], y: p.inst.position[1], radius: Math.max(p.size.width / 2, 0.3), height: Math.max(p.size.height, 0.3), color: fs.color, diameterFt: fs.diameterFt, pieceFt: p.species.fruit!.diameterFt, aspect: fs.aspect });
    }
  }

  const sunAt = (x: number, y: number) => (input.sunMap ? sunHoursAt(input.sunMap, x, y) : null);
  w.flowers = input.plants
    .filter((p) => p.size.planted && isBlooming(p.species, input.month) && p.species.pollinator.groups.length > 0)
    .map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], radius: Math.max(p.size.width / 2, 0.3), height: Math.max(p.size.height, 0.3), groups: [...p.species.pollinator.groups], sun: sunAt(p.inst.position[0], p.inst.position[1]) }));
  w.perches = input.plants
    .filter((p) => p.size.planted && p.size.height >= 3 && ['tree', 'shrub', 'edible'].includes(p.species.type))
    .map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], z: p.size.height * 0.92, r: Math.max(p.size.width / 2, 0.3) }));
  w.wormSpots = buildWormSpots(w, input, cfg, classes, sunAt);
  w.birdFood = input.plants
    .filter((p) => {
      if (!p.size.planted || p.size.height < p.species.matureHeight * 0.55) return false; // too young to bear
      return !!p.species.fruit?.ripeMonths.includes(input.month) || !!p.species.birdFood?.months.includes(input.month);
    })
    .map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], radius: Math.max(p.size.width / 2, 0.3), height: Math.max(p.size.height, 0.3) }));

  // The hive: keep the old spot while it is still good, otherwise find a new one.
  const hive = input.hiveAt ?? (input.hive && hiveSpotIsGood(w, input.hive, cfg) ? input.hive : chooseHiveSpot(w, cfg, mulberry32(7)));
  w.hive = hive;
  if (hive) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, y] = center(w, i, j);
        if (Math.hypot(hive.x - x, hive.y - y) < cfg.margins.hiveFt) blocked[idx(w, i, j)] = 1;
      }
    }
  }
  finishWorld(w, cfg);
  w.doors = buildDoors(w, input, cfg);
  const yard = input.site.zones.find((z) => z.id === input.engine.birthday.zone);
  if (yard) w.partyCells = w.reachable.filter((k) => pointInPolygon(((k % w.nx) + 0.5) * w.cell, (Math.floor(k / w.nx) + 0.5) * w.cell, yard.polygon));
  w.tables = buildTables(w, input, cfg);
  w.screen = buildScreen(w, input, cfg);
  if (w.screen) {
    const sc = w.screen, sh = cfg.movie.shadow;
    const tri = beamTriangle(sc.lens, sc.x, sc.y - sc.width / 2, sc.y + sc.width / 2);
    w.beamCells = new Uint8Array(w.nx * w.ny);
    w.beamCost = new Float32Array(w.nx * w.ny);
    for (let j = 0; j < w.ny; j++) for (let i = 0; i < w.nx; i++) {
      const [cx, cy] = center(w, i, j);
      if (inBeam(cx, cy, tri, 1.0)) { w.beamCells[idx(w, i, j)] = 1; w.beamCost[idx(w, i, j)] = sh.beamAvoidCost; }
    }
  }
  // Watching the fireworks: the party yard when it has room, otherwise anywhere in the back half of the lot.
  const cellPt = (k: number): Pt => [((k % w.nx) + 0.5) * w.cell, (Math.floor(k / w.nx) + 0.5) * w.cell];
  const pool = (w.partyCells.length ? w.partyCells : w.reachable.filter((k) => cellPt(k)[1] > depth / 2)).map(cellPt);
  w.skySpots = skyWatchSpots(pool, cfg.fireworks.spotGapFt, mulberry32(11));
  w.rims = buildRims(classes, w.structures);
  w.raised = classes.filter(({ el }) => el.height > 0 && ['patio', 'deck', 'gravel', 'path'].includes(el.type)).map(({ el, poly }) => ({ poly, top: el.height }));
  return w;
}

/** Spots to perch on the rim of a raised bed, one near the middle of each long enough side of a bed with a sitting-height rim. */
function buildRims(classes: { el: HardscapeElement; poly: Pt[] }[], structures: Pt[][]): Rim[] {
  const out: Rim[] = [];
  for (const { el, poly } of classes) {
    if (el.type !== 'raisedBed' || !(el.height >= 1 && el.height <= 3)) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2.4) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      if (pointInPolygon(mx + nx * 0.3, my + ny * 0.3, poly)) { nx = -nx; ny = -ny; }
      // An edge shared with another bed or a wall of the same bed (an L's inside corner) has no room to sit; skip those.
      if (poly.some((q, j) => j !== i && j !== (i + 1) % poly.length && Math.hypot(q[0] - (mx + nx * 1.2), q[1] - (my + ny * 1.2)) < 0.8)) continue;
      const seat: Pt = [mx - nx * 0.35, my - ny * 0.35], outside: Pt = [mx + nx * 1.5, my + ny * 1.5];
      // Never on a bed that touches a building, and the open ground beside it must be clear of one too.
      if (structures.some((st) => [seat, outside, [mx, my] as Pt].some(([px, py]) => pointInPolygon(px, py, st) || distanceToPolygon(px, py, st) < 0.6))) continue;
      out.push({ x: seat[0], y: seat[1], face: Math.atan2(ny, nx), out: outside, z: el.height });
    }
  }
  return out;
}

/** The point on a polygon's outline nearest to (x, y). */
export function nearestOnPolygon(poly: Pt[], x: number, y: number): Pt {
  let best: Pt = poly[0], bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(px - x, py - y);
    if (d < bestD) { bestD = d; best = [px, py]; }
  }
  return best;
}

/** The doors of the buildings that are in the plan, each with a reachable spot to walk to first. */
function buildDoors(w: LifeWorld, input: LifeWorldInput, cfg: Cfg): LifeDoor[] {
  const buildings = new Set(input.structures.map((s) => s.group ?? s.id));
  const out: LifeDoor[] = [];
  for (const d of input.site.doors ?? []) {
    if (!buildings.has(d.building) || !w.reachable.length) continue;
    const want: Pt = [d.point[0] + d.outward[0] * cfg.people.doorApproachFt, d.point[1] + d.outward[1] * cfg.people.doorApproachFt];
    let best: Pt | null = null;
    let bestD = Infinity;
    for (const k of w.reachable) {
      const c = center(w, k % w.nx, Math.floor(k / w.nx));
      const dist = Math.hypot(c[0] - want[0], c[1] - want[1]);
      if (dist < bestD) {
        bestD = dist;
        best = c;
      }
    }
    const at = d.entry ?? d.point;
    if (best) out.push({ id: d.id, label: d.label, building: d.building, opening: d.opening, stand: [at[0] + d.outward[0] * 0.25, at[1] + d.outward[1] * 0.25], approach: best });
  }
  return out;
}


/** Candidate spots for worms across the soil: not under paving, buildings or raised beds, on a loose grid. */
function buildWormSpots(w: LifeWorld, input: LifeWorldInput, cfg: Cfg, classes: { el: HardscapeElement; poly: Pt[] }[], sunAt: (x: number, y: number) => number | null): WormSpot[] {
  const wc = cfg.critters.worms;
  const hard = new Set(['patio', 'deck', 'path', 'table', 'grill', 'raisedBed', 'wall', 'fence']);
  const order = input.engine.hardscape.drawOrder;
  const ranked = [...classes].sort((a, b) => order.indexOf(b.el.type) - order.indexOf(a.el.type)); // topmost first
  const shed = input.plants.filter((p) => p.size.planted).map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], r: p.size.width / 2, litter: litterState(p.species, input.month, input.engine.litter).phase }));
  const out: WormSpot[] = [];
  for (let j = 0; j < w.ny; j += wc.spotStride) {
    for (let i = 0; i < w.nx; i += wc.spotStride) {
      const [x, y] = center(w, i, j);
      if (x < cfg.margins.lotFt || y < cfg.margins.lotFt || x > w.lot.width - cfg.margins.lotFt || y > w.lot.depth - cfg.margins.lotFt) continue;
      if (w.structures.some((st) => pointInPolygon(x, y, st) || distanceToPolygon(x, y, st) < 1)) continue;
      const top = ranked.find((c) => pointInPolygon(x, y, c.poly));
      let rich = false;
      if (top) {
        const t = top.el.type;
        if (hard.has(t)) continue;
        if (t === 'gravel' && top.el.materialId !== 'mulch') continue;
        rich = t === 'bed' || t === 'gravel';
      }
      let litter: WormSpot['litter'] = 'none';
      let under = false;
      for (const p of shed) {
        if (Math.hypot(p.x - x, p.y - y) > p.r) continue;
        under = true;
        if (p.litter === 'composting') litter = 'compost';
        else if ((p.litter === 'lying' || p.litter === 'falling') && litter === 'none') litter = 'fresh';
      }
      const sun = sunAt(x, y);
      out.push({ x, y, rich, litter, shade: sun !== null ? sun <= wc.shadeMaxSunHours : under });
    }
  }
  if (out.length <= wc.spotCap) return out;
  const step = out.length / wc.spotCap;
  return Array.from({ length: wc.spotCap }, (_, k) => out[Math.floor(k * step)]);
}

/** Tables in the plan, with the seats whose standing place behind the chair people can reach. */
function buildTables(w: LifeWorld, input: LifeWorldInput, cfg: Cfg): LifeTable[] {
  const reach = new Set(w.reachable);
  const out: LifeTable[] = [];
  for (const el of input.hardscape) {
    if (el.removed || el.type !== 'table' || el.points.length < 4) continue;
    const { center, seats } = worldSeats(el.id, el.points, cfg.dining.approachFt);
    const usable = seats.filter((st) => {
      const [i, j] = cellOf(w, st.approach[0], st.approach[1]);
      return reach.has(idx(w, i, j));
    });
    if (usable.length >= 2) out.push({ id: el.id, center, seats: usable });
  }
  return out;
}

/** The east wall of the movie building as a screen, with open, reachable ground in front of it to watch from. */
function buildScreen(w: LifeWorld, input: LifeWorldInput, cfg: Cfg): LifeScreen | null {
  const mc = cfg.movie;
  const parts = input.structures.filter((s) => (s.group ?? s.id) === mc.screenBuilding);
  if (!parts.length) return null;
  // The building's easternmost vertical edge.
  let best: { x: number; y0: number; y1: number } | null = null;
  for (const part of parts) {
    const pts = part.footprint;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.abs(a[0] - b[0]) > 0.05) continue;
      const x = a[0];
      const east = !pointInPolygon(x + 0.3, (a[1] + b[1]) / 2, pts);
      if (!east) continue;
      if (!best || x > best.x) best = { x, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
    }
  }
  if (!best) return null;
  const y = (best.y0 + best.y1) / 2;
  const width = Math.min(mc.widthFt, (best.y1 - best.y0) * 0.8);
  const spots: Pt[] = [];
  // Viewers stand out of the projector's light, so nobody watches with a shadow across the screen.
  const tri = beamTriangle([best.x + mc.projectorFromWallFt - 0.55, y, mc.projectorHeightFt], best.x, y - width / 2, y + width / 2);
  for (const k of w.reachable) {
    const [cx, cy] = center(w, k % w.nx, Math.floor(k / w.nx));
    if (cx - best.x >= mc.spotFromWallFt[0] && cx - best.x <= mc.spotFromWallFt[1] && Math.abs(cy - y) <= mc.spotLateralFt && !inBeam(cx, cy, tri, 1.4)) spots.push([cx, cy]);
  }
  if (spots.length < 3) return null;
  const lens: [number, number, number] = [best.x + mc.projectorFromWallFt - 0.55, y, mc.projectorHeightFt];
  return { x: best.x, y, width, bottom: mc.bottomFt, height: mc.heightFt, spots, projector: [best.x + mc.projectorFromWallFt, y], lens };
}

/** Inflate the cost beside blocked ground, then find the largest connected open region and the path cells in it. */
function finishWorld(w: LifeWorld, cfg: Cfg) {
  const near = Math.max(1, Math.round(cfg.margins.nearBlockedFt / w.cell));
  const extra = new Float32Array(w.cost.length);
  for (let j = 0; j < w.ny; j++) {
    for (let i = 0; i < w.nx; i++) {
      if (w.blocked[idx(w, i, j)]) continue;
      let touches = false;
      for (let dj = -near; dj <= near && !touches; dj++) {
        for (let di = -near; di <= near; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= w.nx || b >= w.ny || w.blocked[idx(w, a, b)]) touches = true;
          if (touches) break;
        }
      }
      if (touches) extra[idx(w, i, j)] = cfg.margins.nearBlockedExtraCost;
    }
  }
  for (let k = 0; k < w.cost.length; k++) w.cost[k] += extra[k];
  // Connected regions by 4-neighbour flood fill.
  const seen = new Int32Array(w.blocked.length).fill(-1);
  let best: number[] = [];
  let label = 0;
  for (let start = 0; start < w.blocked.length; start++) {
    if (w.blocked[start] || seen[start] >= 0) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = label;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const i = k % w.nx, j = Math.floor(k / w.nx);
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
        if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue;
        const n = idx(w, a, b);
        if (!w.blocked[n] && seen[n] < 0) {
          seen[n] = label;
          stack.push(n);
        }
      }
    }
    if (comp.length > best.length) best = comp;
    label++;
  }
  w.reachable = best;
  w.pathCells = best.filter((k) => w.isPath[k] === 1);
}

/** A hive spot is good when it is well away from paths and buildings, clear of plants, and inside the lot. */
export function hiveSpotIsGood(w: LifeWorld, h: { x: number; y: number }, cfg: Cfg): boolean {
  const hc = cfg.bees.hive;
  if (h.x < cfg.margins.lotFt || h.y < cfg.margins.lotFt || h.x > w.lot.width - cfg.margins.lotFt || h.y > w.lot.depth - cfg.margins.lotFt) return false;
  if (w.structures.some((s) => pointInPolygon(h.x, h.y, s) || distanceToPolygon(h.x, h.y, s) < hc.minFromStructureFt)) return false;
  if (w.plants.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < p.r + hc.minFromPlantFt)) return false;
  const reach = Math.ceil(hc.minFromPathFt / w.cell);
  const [ci, cj] = cellOf(w, h.x, h.y);
  for (let j = cj - reach; j <= cj + reach; j++) {
    for (let i = ci - reach; i <= ci + reach; i++) {
      if (i < 0 || j < 0 || i >= w.nx || j >= w.ny) continue;
      const [x, y] = center(w, i, j);
      if (w.isPath[idx(w, i, j)] && Math.hypot(x - h.x, y - h.y) < hc.minFromPathFt) return false;
    }
  }
  return true;
}

/** The best spot for the hive among many tries: far from paths and buildings, with flowers within reach. */
export function chooseHiveSpot(w: LifeWorld, cfg: Cfg, rng: () => number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let n = 0; n < cfg.bees.hive.attempts; n++) {
    const h = { x: cfg.margins.lotFt + rng() * (w.lot.width - 2 * cfg.margins.lotFt), y: cfg.margins.lotFt + rng() * (w.lot.depth - 2 * cfg.margins.lotFt) };
    if (!hiveSpotIsGood(w, h, cfg)) continue;
    const nearBloom = w.blooms.length ? Math.min(...w.blooms.map((b) => Math.hypot(b.x - h.x, b.y - h.y))) : 30;
    const fromStructure = w.structures.length ? Math.min(12, ...w.structures.map((s) => distanceToPolygon(h.x, h.y, s))) : 12;
    const score = fromStructure - Math.min(nearBloom, 30) * 0.4 + cfg.bees.hive.rearBias * (h.y / w.lot.depth) + rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------------------------

class Heap {
  private a: { f: number; k: number }[] = [];
  get size() { return this.a.length; }
  push(f: number, k: number) {
    const a = this.a;
    a.push({ f, k });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.k;
  }
}

/** The cheapest walk between two cells, by A* over 8 neighbours with no corner cutting. Null when there is none. */
export function findRoute(w: LifeWorld, from: Pt, to: Pt): Pt[] | null {
  const [si, sj] = cellOf(w, from[0], from[1]);
  const [ti, tj] = cellOf(w, to[0], to[1]);
  const start = idx(w, si, sj), goal = idx(w, ti, tj);
  if (w.blocked[start] || w.blocked[goal]) return null;
  const g = new Float32Array(w.blocked.length).fill(Infinity);
  const parent = new Int32Array(w.blocked.length).fill(-1);
  const done = new Uint8Array(w.blocked.length);
  const h = (k: number) => Math.hypot((k % w.nx) - ti, Math.floor(k / w.nx) - tj) * w.cell * w.minCost;
  const heap = new Heap();
  g[start] = 0;
  heap.push(h(start), start);
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = k % w.nx, j = Math.floor(k / w.nx);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue;
        const n = idx(w, a, b);
        if (w.blocked[n] || done[n]) continue;
        if (di && dj && (w.blocked[idx(w, i + di, j)] || w.blocked[idx(w, i, j + dj)])) continue; // no cutting corners
        const bc = w.beamOn ? w.beamCost : null; // crossing the projector's beam costs more while a film shows
        const step = Math.hypot(di, dj) * w.cell * (w.cost[k] + w.cost[n] + (bc ? bc[k] + bc[n] : 0)) * 0.5;
        const ng = g[k] + step;
        if (ng < g[n]) {
          g[n] = ng;
          parent[n] = k;
          heap.push(ng + h(n), n);
        }
      }
    }
  }
  if (!Number.isFinite(g[goal])) return null;
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = parent[k]) cells.push(k);
  cells.reverse();
  let pts: Pt[] = cells.map((k) => center(w, k % w.nx, Math.floor(k / w.nx)));
  // Soften the corners, keeping every point on open ground.
  for (let pass = 0; pass < 2; pass++) {
    pts = pts.map((p, n) => {
      if (n === 0 || n === pts.length - 1) return p;
      const q: Pt = [(pts[n - 1][0] + p[0] * 2 + pts[n + 1][0]) / 4, (pts[n - 1][1] + p[1] * 2 + pts[n + 1][1]) / 4];
      const [qi, qj] = cellOf(w, q[0], q[1]);
      return w.blocked[idx(w, qi, qj)] ? p : q;
    });
  }
  return pts;
}

/** What a person is doing apart from walking: taking a seat at a table, or watching the movie. */
export type Act =
  | { kind: 'dine'; seat: string; phase: 'to' | 'pull' | 'sit' | 'talk' | 'rise' | 'push'; t: number; left: number }
  | { kind: 'watch'; phase: 'to' | 'watch'; spot: Pt; /** The fireworks, not the film: face the sky beyond the back of the lot. */ sky?: boolean }
  | { kind: 'cake'; seat: string; phase: 'to' | 'gather' }
  /** Picking ripe fruit into a basket: walk to a plant, pick a few pieces, move to a different plant, and go in with the basket. */
  /** Two free people meet to talk, sometimes hugging first: each walks to a spot facing the other, the pair greet (a hug brings them closer than people pass), then talk and part. */
  | { kind: 'meet'; phase: 'to' | 'wait' | 'greet' | 'talk'; partner: number; spot: Pt; hug: boolean; /** Opens with a high five instead. */ five: boolean; /** Seconds into this phase. */ t: number; /** How long the phase lasts. */ left: number; /** Who is speaking, by walker index, and for how much longer. */ speaker: number; speakerLeft: number }
  | { kind: 'linger'; what: LingerKind; phase: 'to' | 'do'; spot: Pt; /** What they look at. */ face: Pt | null; left: number; t: number; /** The rim they perch on, or the place they lean. */ rim: Rim | null; lean: LeanSpot | null; color: string | null; turns: number }
  | { kind: 'dodge'; phase: 'to'; spot: Pt }
  | { kind: 'chase'; phase: 'run' | 'tag'; target: number; left: number; t: number; replan: number }
  | { kind: 'harvest'; phase: 'to' | 'pick'; plant: string; stand: Pt; /** Pieces still to take from this plant. */ chunk: number; /** Seconds into the current pick. */ t: number; /** A pick is under way (the hand is out, carrying, or coming back). */ cycle: boolean; fired: boolean; /** How full (as used volume, cubic feet) they want the basket before carrying it in. */ final: number; /** Species already picked from. */ species: string[] };

/** What a person carries when picking: fruit in the basket, and how many it holds. */
export interface Basket {
  /** How much it holds, in cubic feet; fruit piled in fills `packing` of it, so a pick of fruit uses more than its own volume. */
  volume: number;
  /** The volume used so far, counting the gaps between the fruit. */
  used: number;
  /** One piece per pick: a handful of small fruit or a single large one, drawn as one ball of that volume. */
  items: { color: string; d: number; aspect: number }[];
}

/** A basket's dimensions from its volume, in feet: top radius, bottom radius and depth. */
export function basketDims(volume: number, cfg: { basket: { flare: number; heightShare: number } }): { top: number; bottom: number; depth: number } {
  const { flare, heightShare } = cfg.basket;
  // A frustum: V = pi h / 3 (R^2 + R r + r^2) with r = flare R and h = heightShare R.
  const top = Math.cbrt(volume / ((Math.PI * heightShare / 3) * (1 + flare + flare * flare)));
  return { top, bottom: top * flare, depth: top * heightShare };
}

/** The volume of one pick of a plant's fruit, as fruit: a whole piece when it is big, or a handful when it is small. */
export function pickVolumeFt3(plant: { pieceFt: number; aspect: number }, cfg: { handfulFt3: number }): number {
  const piece = (Math.PI / 6) * plant.pieceFt ** 3 * plant.aspect;
  return Math.max(piece, cfg.handfulFt3);
}

/** What a pick takes up in a basket, counting the gaps between the fruit. */
export const pickBulkFt3 = (plant: { pieceFt: number; aspect: number }, cfg: { handfulFt3: number; packing: number }): number => pickVolumeFt3(plant, cfg) / cfg.packing;

/** The diameter of the ball drawn for one pick, so what is drawn has the volume that is taken. */
export const pickBallFt = (plant: { pieceFt: number; aspect: number }, cfg: { handfulFt3: number }): number => Math.cbrt((6 * pickVolumeFt3(plant, cfg)) / Math.PI / plant.aspect);

/** How many picks of a plant's fruit a basket of this volume holds. */
export const basketPicks = (volume: number, plant: { pieceFt: number; aspect: number }, cfg: { handfulFt3: number; packing: number }): number => Math.floor(volume / pickBulkFt3(plant, cfg));

/** One piece of fruit in the air between the plant and the basket. */
export interface Flight {
  walker: number;
  start: [number, number, number];
  /** 0 at the plant, 1 in the basket. */
  p: number;
  color: string;
  /** The ball drawn once it is in the basket, and what it takes up there. */
  d: number;
  /** The size it hangs at on the plant. */
  from: number;
  bulk: number;
  aspect: number;
}

/** A place to lean on a building's wall: where they stand, the wall point, and which way they face (away from the wall). */
export interface LeanSpot {
  stand: Pt;
  wall: Pt;
  face: number;
}

export type Pose = 'none' | 'phone' | 'snack' | 'folded' | 'spin' | 'tag' | 'puppet' | 'door';

export interface Walker {
  kind: 'person' | 'dog';
  x: number;
  y: number;
  heading: number;
  /** Current speed in feet per second, zero while pausing. */
  speed: number;
  /** Steps through the gait, for animating legs. */
  gait: number;
  route: Pt[];
  pauseLeft: number;
  /** A person a dog or a small child follows. */
  leader: number | null;
  /** Going into, inside, or coming out of a building. Hidden while `inside`. */
  visit: { door: string; phase: 'to' | 'in' | 'inside' | 'out'; left: number; /** Inside, time is up and they are waiting for the door to open before stepping out. */ opening?: boolean; /** Gone in for the night: stays until morning. */ night?: boolean } | null;
  /** Out of sight for the night in a plan with no door to go in by. */
  away: boolean;
  /** Sitting down to talk at a table, or standing to watch the movie. */
  act: Act | null;
  /** How far down into a chair they are, 0 standing to 1 seated. */
  sit: number;
  /** From the roster, for the body and the clothes: sex, build, family, shirt and hair color. */
  sex?: 'f' | 'm';
  build?: 'slim' | 'average' | 'broad';
  family?: string;
  shirt?: string;
  hair?: string;
  /** How long a step is at their walking speed, in feet: the legs swing to match how far they travel. */
  stepFt: number;
  /** A basket in hand while picking fruit, and on the walk indoors with it. */
  basket: Basket | null;
  /** How far through a pick the hand is, 0 to 1: reaching for the fruit, pulling it free, carrying it to the basket, then back to rest. */
  pickU: number;
  /** Where the fruit being picked hangs, in site coordinates, while a pick is under way. */
  aim: [number, number, number] | null;
  /** How far into a hug, 0 to 1. */
  hug: number;
  /** Seconds held up by someone in the way. */
  blockedS: number;
  /** Seconds, lately, without making headway while on the move; at `giveUpS` the errand is dropped. */
  heldTotal: number;
  /** Where they were a few seconds ago and how long ago, for checking headway. */
  probeX: number;
  probeY: number;
  probeT: number;
  /** Seconds before this person will start another meeting. */
  meetCool: number;
  /** True while this person is the one speaking at their table. */
  talking: boolean;
  /** True while they are cheering and clapping around the cake. */
  cheer: boolean;
  /** Head tipped back to watch fireworks. */
  lookUp: boolean;
  /** How far their head is turned from straight ahead, toward whoever is speaking, in radians. */
  headTurn: number;
  /** Age in years: a dog is 0. */
  age: number;
  /** How tall they stand, in feet. */
  heightFt: number;
  /** Looks, chosen once. */
  variant: number;
  replan: number;
  cruise: number;
  /** Traits that make each person different: pace, how they weave, who they notice. */
  pers: Personality;
  /** Distance walked and the sideways offset applied so far, for the weave. */
  weaveD: number;
  weaveOff: number;
  /** Seconds of skipping left, and of waving at someone. */
  skip: number;
  wave: number;
  /** How much they smile, 0 to 1, how far their head tips down (radians, down is positive), how far the trunk bends forward (negative leans back). */
  smile: number;
  headPitch: number;
  bend: number;
  /** How far the right arm is up for a high five, 0 to 1. */
  five: number;
  pose: Pose;
  /** Seconds in the current pose. */
  poseT: number;
  /** Color of the fruit in hand while snacking. */
  snackColor: string | null;
  /** Height of the seat they sit on when it is not a chair's, and the rim they perch on. */
  seatZ: number | null;
  /** Height of the ground under the feet (a porch or stoop is above the lot), eased as they step up or down. */
  gz: number;
  /** Whom or what the head is turned toward for now: a place, or a walker's index, and seconds left. */
  glance: { kind: 'person' | 'dog' | 'bee' | 'bloom'; x: number; y: number; who: number; left: number } | null;
  glanceCool: number;
  gazeTick: number;
  greetCool: number;
  playCool: number;
  /** Seconds in the projector's light (a shadow across the screen); seconds still to wave at the one who is; who that is (a walker index, or -1); and how long, once waved at, before they step out of it (null when not yet decided). */
  shadowS: number;
  shoo: number;
  shooAt: number;
  reactT: number | null;
}

/** Perching on a raised bed's rim or leaning on a wall: the only times someone stands on ground that is otherwise blocked (besides a door or a chair). */
export const restsOnEdge = (w: Walker): boolean => w.act?.kind === 'linger' && w.act.phase === 'do' && (w.act.what === 'perch' || w.act.what === 'lean');

/** True while a person is inside a building and so not to be drawn. */
export const isInside = (w: Walker): boolean => w.visit?.phase === 'inside' || w.away;

export interface BeeState {
  x: number;
  y: number;
  z: number;
  phase: 'rest' | 'out' | 'forage' | 'back';
  timer: number;
  target: { x: number; y: number; z: number; radius: number } | null;
  angle: number;
  wobble: number;
  /** Speed in feet per second. */
  speed: number;
  /** Direction it faces, in radians, for drawing. */
  heading: number;
}

export interface LifeCounts {
  people: number;
  dogs: number;
  bees: boolean;
  /** How many bees leave the hive, up to the configured number; the default is all of them. */
  beeCount?: number;
}

/**
 * The people, dogs and bees in the yard. People walk to places, favoring paths because paths are the cheapest ground,
 * and never enter a plant's canopy or a building. Dogs trot after a person and sniff about. Bees leave the hive for
 * flowers in bloom, feed, and come back. Deterministic for a seed; step it with real time.
 */
export class LifeSim {
  world: LifeWorld;
  walkers: Walker[] = [];
  bees: BeeState[] = [];
  /** How far each chair is pulled out, by seat id, 0 (in) to 1 (fully out). Chairs not here are in. */
  chairs = new Map<string, number>();
  /** How far each door is open, by sim door id, 0 (shut) to 1 (wide open), and how long it stays open after the last person. */
  private doors = new Map<string, { open: number; hold: number }>();
  /** Seat id -> the walker sitting or heading there. */
  private seatTaken = new Map<string, number>();
  private tableTalk = new Map<string, { speaker: number; left: number }>();
  /** Minute of the day, set by the caller; the movie shows between the configured start and end. */
  minutes = 720;
  movieOn = false;
  /** The day's birthday, if there is one: set by the caller. */
  birthday: BirthdayDay | null = null;
  /** The party is on (hats, the party yard), and the cake is out (everyone at the table). */
  party = false;
  cake = false;
  /** Presents are out from the start of the party until night. */
  presentsOut = false;
  /** Balloons are tied up outside the doors from the morning of a birthday until night. */
  balloonsOut = false;
  /** Fruit flying from a plant to a basket, drawn by the scene. */
  flights: Flight[] = [];
  private clock = 0;
  private rng: () => number;
  private cfg: Cfg;
  /** The body proportions, to work out step lengths. */
  anatomy: AnatomyCfg;
  private counts: LifeCounts;

  constructor(world: LifeWorld, cfg: Cfg, seed: number, counts: LifeCounts, anatomy: AnatomyCfg = defaultAnatomy) {
    this.world = world;
    this.cfg = cfg;
    this.anatomy = anatomy;
    this.rng = mulberry32(seed);
    this.counts = { people: Math.max(0, Math.min(cfg.people.max, Math.floor(counts.people))), dogs: Math.max(0, Math.min(cfg.dogs.max, Math.floor(counts.dogs))), bees: counts.bees, beeCount: counts.beeCount };
    this.populate();
  }

  private between = ([lo, hi]: [number, number]) => lo + this.rng() * (hi - lo);

  private randomCell(): Pt | null {
    const r = this.world.reachable;
    if (!r.length) return null;
    const k = r[Math.floor(this.rng() * r.length)];
    return center(this.world, k % this.world.nx, Math.floor(k / this.world.nx));
  }

  private populate() {
    this.walkers = [];
    for (let n = 0; n < this.counts.people + this.counts.dogs; n++) {
      const p = this.randomCell();
      if (!p) break;
      const person = n < this.counts.people;
      const spec = person ? this.cfg.people.roster[n] : null;
      // A small child stays near an adult; a dog stays near a person.
      let leader: number | null = null;
      if (spec && spec.age < TODDLER_AGE_LIMIT) {
        const adults = this.cfg.people.roster.slice(0, n).map((r, i) => (r.age >= ADULT_AGE ? i : -1)).filter((i) => i >= 0);
        leader = adults.length ? adults[adults.length - 1] : null;
      } else if (!person && this.counts.people > 0) leader = (n - this.counts.people) % this.counts.people;
      this.walkers.push({
        kind: person ? 'person' : 'dog', x: p[0], y: p[1], heading: this.rng() * Math.PI * 2, speed: 0, gait: this.rng() * 6, route: [],
        pauseLeft: this.rng() * 2, leader, visit: null, act: null, sit: 0, stepFt: 1.5, basket: null, pickU: 0, aim: null, hug: 0, blockedS: 0, heldTotal: 0, probeX: 0, probeY: 0, probeT: 0, meetCool: this.rng() * 30, talking: false, cheer: false, lookUp: false, headTurn: 0, away: false, age: spec?.age ?? 0, heightFt: spec?.heightFt ?? this.cfg.dogs.heightFt, variant: Math.floor(this.rng() * 1000),
        replan: 0, cruise: this.between(spec ? spec.speedFt : this.cfg.dogs.speedFt),
        pers: personalityOf(this.rng, this.cfg.people.manner), weaveD: this.rng() * 20, weaveOff: 0, skip: 0, wave: 0, smile: 0.15, headPitch: 0, bend: 0, five: 0, pose: 'none', poseT: 0, snackColor: null, seatZ: null, gz: 0, glance: null, glanceCool: this.rng() * 3, gazeTick: this.rng() * 0.25, greetCool: this.rng() * 10, playCool: this.rng() * 20, shadowS: 0, shoo: 0, shooAt: -1, reactT: null,
      });
      const made = this.walkers[this.walkers.length - 1];
      if (spec) {
        made.sex = spec.sex;
        made.build = spec.build;
        made.family = spec.family;
        made.shirt = spec.shirt;
        made.hair = spec.hair;
        made.stepFt = stepLengthFt(bodyOf(spec.age, spec.heightFt, this.anatomy, spec.sex, spec.build), made.cruise, this.anatomy);
      }
    }
    this.bees = [];
    const hive = this.world.hive;
    if (this.counts.bees && hive) {
      for (let n = 0; n < Math.min(this.cfg.bees.count, Math.max(0, Math.floor(this.counts.beeCount ?? this.cfg.bees.count))); n++) {
        this.bees.push({ x: hive.x, y: hive.y, z: 1.5, phase: 'rest', timer: this.rng() * this.cfg.bees.restS[1] * 2, target: null, angle: this.rng() * 6.28, wobble: this.rng() * 6.28, speed: this.between(this.cfg.bees.speedFt), heading: 0 });
      }
    }
  }

  /** The yard changed (a plant grew, something was drawn): re-plan, and move anyone now standing on blocked ground. */
  setWorld(world: LifeWorld) {
    this.world = world;
    this.leanSpots = null;
    for (const wk of this.walkers) {
      wk.route = [];
      // A seat, or the screen, that is gone ends what they were doing there; the rest carry on.
      if (wk.act?.kind === 'meet') {
        // A meeting carries on where it is; one still on the way walks again.
        const partner = this.walkers[wk.act.partner];
        if (!partner || partner.act?.kind !== 'meet') this.endAct(wk);
        else if (wk.act.phase !== 'to') continue;
      } else if (wk.act?.kind === 'harvest') {
        // The tree they were at has stopped bearing (or is gone): take what is in the basket in.
        const a = wk.act;
        if (!world.harvest.some((q) => q.id === a.plant)) this.finishHarvest(wk);
        else if (a.phase === 'pick') continue; // at the plant, picking
      } else if (wk.act?.kind === 'linger' || wk.act?.kind === 'dodge') {
        this.endAct(wk); // the yard changed under them: carry on
      } else if (wk.act?.kind === 'chase') {
        // a chase carries on where it is
      } else if (wk.act) {
        const ok = wk.act.kind === 'watch' ? (wk.act.sky ? world.skySpots.length > 0 : !!world.screen) : !!this.findSeat(wk.act.seat);
        if (!ok) this.endAct(wk);
        else if (wk.act.phase !== 'to') continue; // seated or watching: already where they are
      }
      if (wk.visit && wk.visit.phase !== 'to' && world.doors.some((d) => d.id === wk.visit!.door)) continue; // at their door, already
      if (wk.visit && wk.visit.phase !== 'to') wk.visit = null; // their building is gone
      const [i, j] = cellOf(world, wk.x, wk.y);
      if (world.blocked[idx(world, i, j)]) {
        const p = this.nearestFree(wk.x, wk.y);
        if (p) [wk.x, wk.y] = p;
      }
    }
    if (!world.screen && this.movieOn) this.movieOn = false;
    this.syncBeam();
    if (!world.skySpots.length && this.fireworksOn) this.fireworksOn = false;
    if (!world.hive) this.bees = [];
    else if (this.counts.bees && this.bees.length === 0) this.populate();
  }

  setCounts(counts: LifeCounts) {
    this.counts = { people: Math.max(0, Math.min(this.cfg.people.max, Math.floor(counts.people))), dogs: Math.max(0, Math.min(this.cfg.dogs.max, Math.floor(counts.dogs))), bees: counts.bees, beeCount: counts.beeCount };
    this.populate();
  }

  /** The nearest walkable cell center; with `clearOf`, one that does not put that person's body inside another person's. */
  private nearestFree(x: number, y: number, clearOf?: Walker): Pt | null {
    const w = this.world;
    const others = clearOf ? this.walkers.filter((o) => o !== clearOf && o.kind === 'person' && !o.away && !isInside(o) && !this.mayTouch(clearOf, o)) : [];
    const [ci, cj] = cellOf(w, x, y);
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let r = 0; r < Math.max(w.nx, w.ny) && !best; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= w.nx || j >= w.ny || w.blocked[idx(w, i, j)]) continue;
          const [px, py] = center(w, i, j);
          if (clearOf && others.some((o) => Math.hypot(px - o.x, py - o.y) < this.bodyR(clearOf) + this.bodyR(o))) continue;
          const d = Math.hypot(px - x, py - y);
          if (d < bestD) {
            bestD = d;
            best = [px, py];
          }
        }
      }
    }
    return best;
  }

  private pickPersonTarget(wk: Walker): Pt | null {
    const w = this.world;
    for (let tries = 0; tries < 20; tries++) {
      let p: Pt | null;
      if (this.party && w.partyCells.length && this.rng() < this.cfg.party.backyardBias) {
        const k = w.partyCells[Math.floor(this.rng() * w.partyCells.length)];
        p = center(w, k % w.nx, Math.floor(k / w.nx));
      } else if (w.pathCells.length && this.rng() < this.cfg.people.pathBias) {
        const k = w.pathCells[Math.floor(this.rng() * w.pathCells.length)];
        p = center(w, k % w.nx, Math.floor(k / w.nx));
      } else p = this.randomCell();
      // During a film nobody picks a place in the projector's beam, except by forgetting (kids most).
      if (p && this.movieOn && w.beamCells && w.beamCells[idx(w, ...cellOf(w, p[0], p[1]))] && this.rng() >= this.cfg.movie.shadow.forgetChance[ageGroup(wk.age)]) continue;
      if (p && Math.hypot(p[0] - wk.x, p[1] - wk.y) >= this.cfg.people.minTripFt) return p;
    }
    return this.randomCell();
  }

  /** Somewhere near the person this walker follows, or anywhere when they follow no one. */
  private pickFollowTarget(wk: Walker): Pt | null {
    const leader = wk.leader !== null ? this.walkers[wk.leader] : null;
    if (!leader) return this.randomCell();
    const a = this.rng() * Math.PI * 2;
    const d = this.between(wk.kind === 'dog' ? this.cfg.dogs.followFt : this.cfg.people.toddlerFollowFt);
    const t = this.nearestFree(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d);
    return t;
  }

  /** Sometimes a grown-up or older child heads for a building instead of just somewhere in the yard. */
  private pickDoor(wk: Walker): LifeDoor | null {
    const doors = this.world.doors;
    if (!doors.length || wk.leader !== null || wk.kind !== 'person' || this.rng() >= this.cfg.people.visitBias * (this.party ? this.cfg.party.visitFactor : 1)) return null;
    const buildings = [...new Set(doors.map((d) => d.building))];
    const building = buildings[Math.floor(this.rng() * buildings.length)];
    const options = doors.filter((d) => d.building === building);
    return options[Math.floor(this.rng() * options.length)];
  }

  private plan(wk: Walker) {
    // On the way to a chair or a viewing spot: keep heading there, or give up if it cannot be reached.
    if (wk.act?.phase === 'to') {
      const target = this.actTarget(wk);
      const route = target ? findRoute(this.world, [wk.x, wk.y], target) : null;
      if (route) {
        wk.route = route.slice(1);
        if (route.length <= 1) this.arrive(wk);
        return;
      }
      this.endAct(wk);
    }
    // Free to choose: the movie, if it is showing, or a seat at the table, now and then.
    if (this.idle(wk)) {
      if (this.cake && this.rng() < this.cfg.party.cakeBias && this.sendToCake(wk)) return;
      if (this.fireworksOn && this.rng() < this.fireworksCfg.attendBias && this.assignSky(wk)) return;
      if (this.movieOn && this.rng() < this.cfg.movie.joinBias && this.assignWatch(wk)) return;
      if (this.world.tables.length && this.rng() < this.cfg.dining.bias && this.startDinner(wk)) return;
      if (this.harvestOk(wk) && this.rng() < this.cfg.harvest.bias && this.startHarvest(wk)) return;
      if (this.rng() < this.cfg.people.meet.bias && this.startMeet(wk)) return;
      const M = this.cfg.people.manner;
      if (wk.playCool <= 0 && wk.age >= M.play.minAge && wk.age <= M.play.maxAge && this.rng() < M.play.chaseBias && this.startChase(wk)) return;
      if (this.movieOn && this.rng() < this.cfg.movie.shadow.puppet.bias && this.startPuppet(wk)) return;
      if (this.rng() < M.linger.bias * (1.3 - 0.6 * wk.pers.energy) && this.startLinger(wk)) return;
    }
    if (wk.visit?.phase === 'to' && !this.world.doors.some((d) => d.id === wk.visit!.door)) wk.visit = null;
    const door = wk.visit?.phase === 'to' ? this.world.doors.find((d) => d.id === wk.visit!.door)! : this.pickDoor(wk);
    if (door) {
      const route = findRoute(this.world, [wk.x, wk.y], door.approach);
      if (route) {
        wk.visit = { door: door.id, phase: 'to', left: 0, ...(wk.visit?.night ? { night: true } : {}) };
        wk.route = route.slice(1);
        if (route.length <= 1) this.startEntering(wk);
        return;
      }
      wk.visit = null;
    }
    const target = wk.kind === 'person' && wk.leader === null ? this.pickPersonTarget(wk) : this.pickFollowTarget(wk);
    if (!target) return;
    const route = findRoute(this.world, [wk.x, wk.y], target);
    wk.route = route ? route.slice(1) : [];
    if (!route) wk.pauseLeft = 0.5;
    const P = this.cfg.people.manner.play;
    if (route && wk.kind === 'person' && wk.leader === null && wk.age >= P.minAge && wk.age <= P.maxAge && this.rng() < P.skipChance) wk.skip = this.between(P.skipS);
  }

  /** How far a door is open, 0 to 1. */
  doorOpenness(id: string): number {
    return this.doors.get(id)?.open ?? 0;
  }

  /** Whether someone needs this door open now: about to go in (at the door), waiting inside to come out, or just come out. */
  private doorWanted(door: LifeDoor): boolean {
    const D = this.cfg.people.door;
    return this.walkers.some((w) => {
      const v = w.visit;
      if (!v || v.door !== door.id) return false;
      const d = Math.hypot(w.x - door.stand[0], w.y - door.stand[1]);
      if (v.phase === 'in') return d <= D.reachFt + 0.4;
      if (v.phase === 'inside') return !!v.opening;
      if (v.phase === 'out') return d <= D.reachFt + 0.6;
      return false;
    });
  }

  /** Doors swing open when someone is at them and close a moment after the last person has gone through. */
  private stepDoors(dt: number) {
    const D = this.cfg.people.door;
    for (const door of this.world.doors) {
      const st = this.doors.get(door.id) ?? { open: 0, hold: 0 };
      this.doors.set(door.id, st);
      if (this.doorWanted(door)) st.hold = D.closeDelayS;
      else st.hold = Math.max(0, st.hold - dt);
      const target = st.hold > 0 ? 1 : 0;
      const step = dt / Math.max(0.05, D.swingS);
      st.open = target > st.open ? Math.min(target, st.open + step) : Math.max(target, st.open - step);
    }
  }

  /** They have reached the spot outside a door: step in. */
  private startEntering(wk: Walker) {
    if (!wk.visit) return;
    wk.visit.phase = 'in';
    wk.route = [];
    wk.speed = 0;
  }

  /** Going in, staying, and coming out of a door, which is a straight walk over the last few feet. */
  private stepVisit(wk: Walker, dt: number) {
    const v = wk.visit!;
    const door = this.world.doors.find((d) => d.id === v.door);
    if (!door) {
      wk.visit = null;
      const p = this.nearestFree(wk.x, wk.y);
      if (p) [wk.x, wk.y] = p;
      return;
    }
    if (v.phase === 'inside') {
      v.left -= dt;
      wk.speed = 0;
      wk.x = door.stand[0];
      wk.y = door.stand[1];
      // Step out only when no one is standing in the doorway, and once the door has been opened for them (they open it from inside).
      if (v.left <= 0 && !this.crowded(door.stand[0], door.stand[1], wk)) {
        v.opening = true;
        if (this.doorOpenness(door.id) >= 0.97) {
          v.opening = false;
          v.phase = 'out';
        }
      }
      return;
    }
    const goal = v.phase === 'in' ? door.stand : door.approach;
    const dx = goal[0] - wk.x, dy = goal[1] - wk.y;
    const dist = Math.hypot(dx, dy);
    const speed = wk.cruise * 0.7;
    let move = Math.min(dist, speed * dt);
    // Going in: stop at arm's length from the door, reach for it, and go on only once it is open.
    if (v.phase === 'in' && wk.kind === 'person') {
      const reach = this.cfg.people.door.reachFt;
      if (dist < reach + 0.4 && this.doorOpenness(door.id) < 0.97) wk.pose = 'door'; // the arm goes out as they come up to it
      if (dist - move < reach && this.doorOpenness(door.id) < 0.97) {
        move = Math.max(0, dist - reach);
        if (dist - reach < 0.05) {
          wk.pose = 'door';
          wk.speed = 0;
          if (dist > 1e-6) wk.heading = Math.atan2(dy, dx);
          return;
        }
      }
    }
    if (dist > 1e-6) {
      wk.heading = Math.atan2(dy, dx);
      const adj = wk.kind === 'person' ? this.avoid(wk, wk.x + (dx / dist) * move, wk.y + (dy / dist) * move) : [wk.x + (dx / dist) * move, wk.y + (dy / dist) * move] as Pt;
      if (adj) {
        move = Math.hypot(adj[0] - wk.x, adj[1] - wk.y);
        wk.x = adj[0];
        wk.y = adj[1];
      } else {
        move = 0; // someone is in the doorway: wait, and in time give up
        this.heldUp(wk, dt);
      }
    }
    wk.speed = dt > 0 ? move / dt : 0;
    wk.gait += move * Math.PI / wk.stepFt;
    if (dist - move < 0.05) {
      if (v.phase === 'in') {
        wk.basket = null; // set down indoors
        v.phase = 'inside';
        v.left = v.night ? Infinity : this.between(this.cfg.people.lingerS);
        wk.x = door.stand[0];
        wk.y = door.stand[1];
        wk.speed = 0;
      } else {
        wk.visit = null;
        wk.route = [];
        wk.pauseLeft = this.between(this.cfg.people.pauseS) * 0.4;
        wk.speed = 0;
      }
    }
  }


  // -------------------------------------------------------------------------------------------
  // Gatherings: sitting down at the table, and the evening movie
  // -------------------------------------------------------------------------------------------

  // -------------------------------------------------------------------------------------------
  // Personal space, and meeting to talk or hug
  // -------------------------------------------------------------------------------------------

  /** A person's body radius, in feet, from their height. */
  private bodyR(wk: Walker): number {
    return this.cfg.people.bodyRadiusShare * wk.heightFt;
  }

  /** Nearer than people pass: hugging is allowed to be, and so is sitting or standing together at a table or the cake. */
  private mayTouch(a: Walker, b: Walker): boolean {
    const x = a.act, y = b.act;
    if (x?.kind === 'meet' && y?.kind === 'meet' && x.partner === this.walkers.indexOf(b) && (x.phase === 'greet' || y.phase === 'greet')) return true;
    const together = (k?: string) => k === 'dine' || k === 'cake';
    return together(x?.kind) && together(y?.kind);
  }

  /** Whether another picker is already heading for, or standing at, a spot within a person's space of this one. */
  private claimed(x: number, y: number, wk: Walker): boolean {
    const sp = this.cfg.people.spaceFt;
    return this.walkers.some((o) => {
      if (o === wk || o.act?.kind !== 'harvest') return false;
      return Math.hypot(o.act.stand[0] - x, o.act.stand[1] - y) < this.bodyR(wk) + this.bodyR(o) + sp;
    });
  }

  /** Whether another person stands within a person's space of a spot. */
  private crowded(x: number, y: number, wk: Walker): boolean {
    const sp = this.cfg.people.spaceFt;
    return this.walkers.some((o) => o !== wk && o.kind === 'person' && !o.away && !isInside(o) && Math.hypot(o.x - x, o.y - y) < this.bodyR(wk) + this.bodyR(o) + sp);
  }

  /**
   * Where a person ends up after a step toward (nx, ny): the same, or slid round the person in the way so that bodies stay
   * a foot apart; null when there is no room and they must wait. Moving away from someone too close is always allowed.
   */
  private avoid(wk: Walker, nx: number, ny: number): Pt | null {
    const space = this.spaceFor(wk), r = this.bodyR(wk);
    let px = nx, py = ny;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of this.walkers) {
        if (o === wk || o.kind !== 'person' || o.away || isInside(o) || this.mayTouch(wk, o)) continue;
        const minD = r + this.bodyR(o) + space;
        const dxn = px - o.x, dyn = py - o.y, dn = Math.hypot(dxn, dyn);
        if (dn >= minD) continue;
        if (dn >= Math.hypot(wk.x - o.x, wk.y - o.y)) {
          // Not getting closer, but already inside the space: drift outward as they go, so the gap opens back up.
          if (dn < minD && dn > 1e-6) {
            const push = Math.min(minD - dn, 0.04) * 0.5;
            px += (dxn / dn) * push;
            py += (dyn / dn) * push;
            moved = true;
          }
          continue;
        }
        let ux = dn > 1e-6 ? dxn / dn : -Math.sin(wk.heading), uy = dn > 1e-6 ? dyn / dn : Math.cos(wk.heading);
        // Head on, pass on the right.
        const cross = Math.cos(wk.heading) * uy - Math.sin(wk.heading) * ux;
        if (Math.abs(cross) < 0.25) {
          const a = -0.5, c = Math.cos(a), s2 = Math.sin(a);
          [ux, uy] = [ux * c - uy * s2, ux * s2 + uy * c];
        }
        px = o.x + ux * minD;
        py = o.y + uy * minD;
        moved = true;
      }
      if (!moved) break;
    }
    for (const o of this.walkers) {
      if (o === wk || o.kind !== 'person' || o.away || isInside(o) || this.mayTouch(wk, o)) continue;
      const d = Math.hypot(px - o.x, py - o.y);
      if (d < r + this.bodyR(o) + space - 1e-6 && d < Math.hypot(wk.x - o.x, wk.y - o.y)) return null;
    }
    // Slid into a wall, a bed or a plant: there is no way round that side, so wait.
    if ((px !== nx || py !== ny) && this.world.blocked[idx(this.world, ...cellOf(this.world, px, py))]) return null;
    return [px, py];
  }

  /**
   * The clear space this person keeps from others: a foot, but squeezed down to a couple of inches the longer they have been
   * held up, so that two people meeting in a lane too narrow for a foot between them still get past each other without
   * touching, instead of waiting for ever.
   */
  private spaceFor(wk: Walker): number {
    const full = this.cfg.people.spaceFt, floor = 0.2;
    const eased = 1 - wk.heldTotal / (this.cfg.people.giveUpS * 0.5);
    return Math.max(Math.min(full, floor), full * Math.min(1, Math.max(0, eased)));
  }

  /**
   * A safety net under everything else: two people who have ended up closer than they should be (someone walked up to a
   * pair who had stopped, or an errand ended beside them) ease apart, the one with nothing to do moving first, never into a
   * wall, a bed or a plant, and never when they are hugging or seated together.
   */
  /** The height of the highest raised ground at a point (0 on the lot). */
  groundAt(x: number, y: number): number {
    let top = 0;
    for (const r of this.world.raised) if (r.top > top && pointInPolygon(x, y, r.poly)) top = r.top;
    return top;
  }

  /** Walkers stand on the porch floor and the stoop, not in them: the feet follow the ground's height, stepping up and down at a pace. */
  private stepGround(dt: number) {
    if (this.world.raised.length === 0) return;
    const rate = this.cfg.people.stepRiseFtS * dt;
    for (const wk of this.walkers) {
      const target = this.groundAt(wk.x, wk.y);
      wk.gz += Math.max(-rate, Math.min(rate, target - wk.gz));
    }
  }

  private separate(dt: number) {
    const ps = this.walkers.filter((w) => w.kind === 'person' && !w.away && !isInside(w));
    const step = 2.5 * dt;
    const free = (x: number, y: number) => !this.world.blocked[idx(this.world, ...cellOf(this.world, x, y))];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (this.mayTouch(a, b)) continue;
        const minD = this.bodyR(a) + this.bodyR(b) + Math.min(this.spaceFor(a), this.spaceFor(b));
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-6) { dx = Math.cos(a.heading); dy = Math.sin(a.heading); d = 1; }
        const ux = dx / d, uy = dy / d, move = Math.min(step, minD - d);
        // Whoever is busy stays where they are; whoever is free gives way. If both are busy or both free, both give way.
        const busy = (w: Walker) => !!w.act && w.act.phase !== 'to';
        const aMoves = !busy(a) || busy(b), bMoves = !busy(b) || busy(a);
        const share = aMoves && bMoves ? 0.5 : 1;
        // Straight apart when that ground is clear; in a lane too narrow for it (a wall or a fence on one side), slide along the
        // lane instead, so two people pressed together still come apart rather than staying overlapped.
        const nudge = (w: Walker, vx: number, vy: number) => {
          const len = move * share;
          for (const turn of [0, 0.9, -0.9, 1.57, -1.57]) {
            const c = Math.cos(turn), sn = Math.sin(turn);
            const nx = (vx * c - vy * sn) * len, ny = (vx * sn + vy * c) * len;
            // never ease into a third person: a step that brings the body inside another's is not an option
            const crowded = ps.some((o) => o !== w && !this.mayTouch(w, o) && Math.hypot(w.x + nx - o.x, w.y + ny - o.y) < Math.min(Math.hypot(w.x - o.x, w.y - o.y), this.bodyR(w) + this.bodyR(o)));
            if (free(w.x + nx, w.y + ny) && !crowded) { w.x += nx; w.y += ny; return; }
          }
        };
        if (aMoves) nudge(a, -ux, -uy);
        if (bMoves) nudge(b, ux, uy);
      }
    }
  }

  /** Held up: after a while, try another route; and when it goes on, give up the errand altogether. */
  private heldUp(wk: Walker, dt: number) {
    wk.blockedS += dt;
    wk.heldTotal += dt;
    if (wk.heldTotal >= this.cfg.people.giveUpS) return this.giveUp(wk);
    if (wk.blockedS > this.cfg.people.blockedReplanS) {
      wk.blockedS = 0;
      wk.route = [];
      wk.pauseLeft = this.rng() * 0.6;
    }
  }

  /** Check every few seconds that someone on the move is getting somewhere; if not, it counts toward giving up. */
  private checkHeadway(wk: Walker, dt: number) {
    wk.probeT += dt;
    if (wk.probeT < 3) return;
    const moved = Math.hypot(wk.x - wk.probeX, wk.y - wk.probeY);
    if (moved < 0.8) wk.heldTotal += 3;
    else wk.heldTotal = Math.max(0, wk.heldTotal - 3);
    wk.probeX = wk.x;
    wk.probeY = wk.y;
    wk.probeT = 0;
    if (wk.heldTotal >= this.cfg.people.giveUpS) this.giveUp(wk);
  }

  /** Stuck with no way through: drop the errand (put the basket down, leave the meeting) and wander off to somewhere else. */
  private giveUp(wk: Walker) {
    wk.heldTotal = 0;
    wk.blockedS = 0;
    wk.probeT = 0;
    wk.route = [];
    const night = !!wk.visit?.night;
    if (night) {
      // Going in for the night: they are in.
      const door = this.world.doors.find((d) => d.id === wk.visit!.door);
      if (door) {
        wk.visit = { door: door.id, phase: 'inside', left: Infinity, night: true };
        wk.x = door.stand[0];
        wk.y = door.stand[1];
        wk.speed = 0;
        return;
      }
    }
    if (wk.act) this.endAct(wk);
    if (wk.visit && wk.visit.phase === 'to') wk.visit = null;
    wk.basket = null;
    wk.pauseLeft = 1 + this.rng() * 2;
    wk.speed = 0;
    // Snap to the middle of a walkable cell, but never into someone else's body: that was a pop of half a foot into the next person.
    const p = this.nearestFree(wk.x, wk.y, wk);
    if (p) [wk.x, wk.y] = p;
  }

  /** Two free people close enough to each other decide to meet: each walks to a spot facing the other. */
  private startMeet(wk: Walker): boolean {
    const m = this.cfg.people.meet;
    if (wk.kind !== 'person' || wk.meetCool > 0 || this.night) return false;
    const self = this.walkers.indexOf(wk);
    const near = this.walkers
      .map((o, i) => ({ o, i, d: Math.hypot(o.x - wk.x, o.y - wk.y) }))
      .filter(({ o, i, d }) => i !== self && o.kind === 'person' && this.idle(o) && o.meetCool <= 0 && !isInside(o) && !o.away && d > m.talkFt && d <= m.rangeFt);
    if (near.length === 0) return false;
    const { o, i } = near[Math.floor(this.rng() * near.length)];
    const mx = (wk.x + o.x) / 2, my = (wk.y + o.y) / 2;
    const dx = o.x - wk.x, dy = o.y - wk.y, dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl, uy = dy / dl;
    const mid = this.nearestFree(mx, my);
    if (!mid) return false;
    const spotA = this.nearestFree(mid[0] - (ux * m.talkFt) / 2, mid[1] - (uy * m.talkFt) / 2);
    const spotB = this.nearestFree(mid[0] + (ux * m.talkFt) / 2, mid[1] + (uy * m.talkFt) / 2);
    if (!spotA || !spotB) return false;
    const apart = Math.hypot(spotA[0] - spotB[0], spotA[1] - spotB[1]);
    if (apart < this.bodyR(wk) + this.bodyR(o) + this.cfg.people.spaceFt) return false;
    // Not where others are already standing about: a hug needs room to close in.
    const room = m.talkFt + 1.5;
    if (this.walkers.some((q) => q !== wk && q !== o && q.kind === 'person' && !q.away && !isInside(q) && (Math.hypot(q.x - mid[0], q.y - mid[1]) < room || Math.hypot(q.x - spotA[0], q.y - spotA[1]) < room * 0.7 || Math.hypot(q.x - spotB[0], q.y - spotB[1]) < room * 0.7))) return false;
    const routeA = findRoute(this.world, [wk.x, wk.y], spotA), routeB = findRoute(this.world, [o.x, o.y], spotB);
    if (!routeA || !routeB) return false;
    const how = greeting(this.cfg.people.manner, m.hugChance, wk.age, o.age, this.rng());
    const hug = how === 'hug', five = how === 'five';
    const mk = (partner: number, spot: Pt): Act => ({ kind: 'meet', phase: 'to', partner, spot, hug, five, t: 0, left: 0, speaker: self, speakerLeft: 0 });
    wk.act = mk(i, spotA);
    o.act = mk(self, spotB);
    for (const [w2, route] of [[wk, routeA], [o, routeB]] as [Walker, Pt[]][]) {
      w2.route = route.slice(1);
      w2.pauseLeft = 0;
    }
    if (routeA.length <= 1) this.arrive(wk);
    if (routeB.length <= 1) this.arrive(o);
    return true;
  }

  private faceToward(wk: Walker, x: number, y: number, dt: number) {
    const want = Math.atan2(y - wk.y, x - wk.x);
    let diff = want - wk.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = this.cfg.people.turnRate * dt;
    wk.heading += Math.max(-turn, Math.min(turn, diff));
  }

  /** Move two people toward or away from each other along the line between them until they are `gap` apart. */
  private closeTo(a: Walker, b: Walker, gap: number, dt: number): boolean {
    const m = this.cfg.people.meet;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
    const diff = d - gap;
    if (Math.abs(diff) < 0.02) return true;
    const step = Math.min(Math.abs(diff) / 2, (m.hugMoveFtS * dt) / 1);
    const k = Math.sign(diff) * step;
    const ux = dx / d, uy = dy / d;
    const free = (who: Walker, other: Walker, x: number, y: number) => {
      if (this.world.blocked[idx(this.world, ...cellOf(this.world, x, y))]) return false;
      // Never into a third person: only toward them while still a foot clear, or away from them.
      return this.walkers.every((o) => {
        if (o === who || o === other || o.kind !== 'person' || o.away || isInside(o)) return true;
        const minD = this.bodyR(who) + this.bodyR(o) + this.cfg.people.spaceFt;
        const dn = Math.hypot(x - o.x, y - o.y);
        return dn >= minD || dn >= Math.hypot(who.x - o.x, who.y - o.y);
      });
    };
    if (free(a, b, a.x + ux * k, a.y + uy * k)) { a.x += ux * k; a.y += uy * k; }
    if (free(b, a, b.x - ux * k, b.y - uy * k)) { b.x -= ux * k; b.y -= uy * k; }
    return false;
  }

  /** Two people meeting: wait for each other, greet (a hug closes the distance), talk in turns, part. */
  private stepMeet(wk: Walker, dt: number) {
    const a = wk.act;
    if (a?.kind !== 'meet') return;
    const self = this.walkers.indexOf(wk);
    const partner = this.walkers[a.partner];
    const pa = partner?.act;
    if (!partner || pa?.kind !== 'meet' || pa.partner !== self || isInside(partner)) return this.endAct(wk);
    wk.speed = 0;
    this.faceToward(wk, partner.x, partner.y, dt);
    // The one with the lower number runs the meeting for both.
    if (self > a.partner) return;
    const m = this.cfg.people.meet;
    const hugGap = this.bodyR(wk) + this.bodyR(partner) + m.hugFt;
    if (a.phase === 'wait') {
      if (pa.phase !== 'wait') return;
      a.phase = pa.phase = 'greet';
      a.t = pa.t = 0;
      a.left = pa.left = a.hug ? this.between(m.hugS) : 0;
      a.speakerLeft = pa.speakerLeft = 0;
      return;
    }
    if (a.phase === 'greet') {
      a.t += dt;
      pa.t = a.t;
      if (a.hug) {
        // Close in, hold (timed from the moment they arrive), then ease apart to talking distance.
        const arrived = Math.hypot(wk.x - partner.x, wk.y - partner.y) <= hugGap + 0.1;
        const holding = a.speakerLeft < a.left && a.t < 8;
        if (holding && arrived) a.speakerLeft += dt;
        const ready = this.closeTo(wk, partner, holding ? hugGap : m.talkFt, dt);
        const arms = holding ? (arrived ? 1 : 0.3) : 0;
        wk.hug += Math.max(-dt * 2, Math.min(dt * 2, arms - wk.hug));
        partner.hug = wk.hug;
        // If something keeps them from closing in or easing apart, give up the hug and just talk.
        if ((!holding && ready && wk.hug <= 0.02) || a.t > 14) {
          wk.hug = partner.hug = 0;
          a.phase = pa.phase = 'talk';
          a.t = pa.t = 0;
          a.speakerLeft = pa.speakerLeft = 0;
          a.left = pa.left = this.between(m.talkS);
        }
      } else if (a.five) {
        // Walk up to arm's length, the right hands meet in the middle, then they talk.
        const G = this.cfg.people.manner.greet;
        const ready = this.closeTo(wk, partner, G.fiveGapFt, dt);
        if (ready || a.speakerLeft > 0) a.speakerLeft = pa.speakerLeft = a.speakerLeft + dt;
        wk.five = partner.five = fiveArm(a.speakerLeft, G.fiveS);
        if (a.speakerLeft >= G.fiveS || a.t > 9) {
          wk.five = partner.five = 0;
          a.phase = pa.phase = 'talk';
          a.t = pa.t = 0;
          a.speakerLeft = pa.speakerLeft = 0;
          a.left = pa.left = this.between(m.talkS) * 0.7;
        }
      } else {
        a.phase = pa.phase = 'talk';
        a.t = pa.t = 0;
        a.left = pa.left = this.between(m.talkS);
      }
      return;
    }
    // talk
    a.t += dt;
    pa.t = a.t;
    a.speakerLeft -= dt;
    if (a.speakerLeft <= 0) {
      a.speaker = a.speaker === self ? a.partner : self;
      a.speakerLeft = this.between(m.speakerS);
    }
    wk.talking = a.speaker === self;
    partner.talking = a.speaker === a.partner;
    if (a.t >= a.left) {
      wk.talking = partner.talking = false;
      this.endAct(partner);
      this.endAct(wk);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Picking fruit: a basket, a plant, a few pieces, a different plant, and the basket carried in
  // -------------------------------------------------------------------------------------------

  /** Someone free, old enough, in daylight, with ripe fruit to pick and room for one more picker. */
  private harvestOk(wk: Walker): boolean {
    const h = this.cfg.harvest;
    if (wk.kind !== 'person' || wk.age < h.minAge || this.night || this.world.harvest.length === 0) return false;
    if (this.minutes < h.fromMin || this.minutes >= h.toMin || wk.basket) return false;
    return this.walkers.filter((q) => q.act?.kind === 'harvest' || (q.basket && q.visit)).length < h.maxPickers;
  }

  /** The open ground nearest to this person within reach of a plant's fruit, or null when none can be reached. */
  private harvestStand(wk: Walker, plant: HarvestPlant): Pt | null {
    const w = this.world, h = this.cfg.harvest;
    let best: Pt | null = null, bestD = Infinity;
    for (const k of w.reachable) {
      const c = center(w, k % w.nx, Math.floor(k / w.nx));
      const d = Math.hypot(c[0] - plant.x, c[1] - plant.y);
      if (d < plant.radius + h.standMinFt || d > plant.radius + h.standMaxFt) continue;
      if (this.crowded(c[0], c[1], wk) || this.claimed(c[0], c[1], wk)) continue;
      const near = Math.hypot(c[0] - wk.x, c[1] - wk.y);
      if (near < bestD) { bestD = near; best = c; }
    }
    return best;
  }

  /** How many picks to take from this plant before moving on, never more than the basket's room or the goal allows. */
  private chunkFor(wk: Walker): number {
    const a = wk.act, b = wk.basket;
    if (a?.kind !== 'harvest' || !b) return 0;
    const plant = this.world.harvest.find((q) => q.id === a.plant);
    if (!plant) return 0;
    const [lo, hi] = this.cfg.harvest.chunk;
    const want = lo + Math.floor(this.rng() * (hi - lo + 1));
    const bulk = pickBulkFt3(plant, this.cfg.harvest);
    const left = Math.min(b.volume, a.final) - b.used;
    return Math.max(1, Math.min(want, Math.ceil(left / bulk - 1e-9)));
  }

  private startHarvest(wk: Walker): boolean {
    const h = this.cfg.harvest;
    const options = this.world.harvest;
    for (let tries = 0; tries < 6; tries++) {
      const plant = options[Math.floor(this.rng() * options.length)];
      const stand = this.harvestStand(wk, plant);
      if (!stand) continue;
      const route = findRoute(this.world, [wk.x, wk.y], stand);
      if (!route) continue;
      const volume = h.basketVolumesFt3[Math.floor(this.rng() * h.basketVolumesFt3.length)];
      const final = volume * this.between(h.fillShare);
      wk.basket = { volume, used: 0, items: [] };
      wk.act = { kind: 'harvest', phase: 'to', plant: plant.id, stand, chunk: 0, t: 0, cycle: false, fired: false, final, species: [plant.speciesId] };
      wk.route = route.slice(1);
      if (route.length <= 1) this.arrive(wk);
      return true;
    }
    return false;
  }

  /**
   * A spot on the canopy the picker's hand can reach: on the side facing them, no further from their shoulder than an arm
   * stretches (about 0.4 of their height), and at a height from the waist up to a little above the shoulder.
   */
  private pickPoint(wk: Walker, plant: HarvestPlant): [number, number, number] {
    const dx = wk.x - plant.x, dy = wk.y - plant.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const arm = wk.heightFt * 0.4;
    const shoulderZ = wk.heightFt * 0.818;
    const lowZ = Math.min(plant.height * 0.3, wk.heightFt * 0.55), highZ = Math.min(plant.height * 0.9, shoulderZ + arm * 0.35);
    const z = Math.max(0.5, lowZ + (Math.max(lowZ, highZ) - lowZ) * this.rng());
    // How far the horizontal reach can be at that height, then how deep into the canopy that allows.
    const vertical = z - shoulderZ;
    const horizontal = Math.sqrt(Math.max(0.04, (arm * 0.92) ** 2 - vertical * vertical));
    const rho = Math.min(plant.radius * (0.55 + 0.35 * this.rng()), Math.max(0, dist - 0.2));
    const r = Math.max(rho, dist - horizontal);
    const jitter = (this.rng() - 0.5) * Math.min(0.8, plant.radius);
    return [plant.x + ux * r - uy * jitter, plant.y + uy * r + ux * jitter, z];
  }

  private stepHarvest(wk: Walker, dt: number) {
    const a = wk.act;
    if (a?.kind !== 'harvest' || !wk.basket) return;
    const plant = this.world.harvest.find((q) => q.id === a.plant);
    if (!plant) return this.finishHarvest(wk);
    const h = this.cfg.harvest;
    wk.speed = 0;
    // Face the plant.
    const want = Math.atan2(plant.y - wk.y, plant.x - wk.x);
    let diff = want - wk.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = this.cfg.people.turnRate * dt;
    wk.heading += Math.max(-turn, Math.min(turn, diff));
    const self = this.walkers.indexOf(wk);
    const air = this.flights.filter((f) => f.walker === self);
    const bulk = pickBulkFt3(plant, h);
    // Room for one more pick, counting what is on its way.
    const room = wk.basket.volume - wk.basket.used - air.reduce((t, f) => t + f.bulk, 0) - bulk + 1e-9;
    if (!a.cycle) {
      // Between picks: start the next, or move on once this plant is done or the basket has no room.
      if (a.chunk > 0 && room >= 0) {
        if (Math.abs(diff) < 0.6) {
          a.cycle = true;
          a.t = 0;
          a.fired = false;
          a.chunk--;
          wk.aim = this.pickPoint(wk, plant);
        }
      } else if (air.length === 0) this.nextStop(wk);
      return;
    }
    // One pick: the hand goes out to the fruit, pulls it free (`pluckAt`), carries it to the basket and lets go (`releaseAt`),
    // then comes back to rest. The fruit rides in the hand between the first two.
    a.t += dt;
    const u = Math.min(1, a.t / h.pickEveryS);
    wk.pickU = u;
    if (!a.fired && u >= h.pluckAt && wk.aim) {
      a.fired = true;
      this.flights.push({ walker: self, start: wk.aim, p: 0, color: plant.color, d: pickBallFt(plant, h), from: plant.diameterFt, bulk, aspect: plant.aspect });
    }
    const f = this.flights.find((q) => q.walker === self);
    if (f) f.p = Math.min(1, Math.max(0, (u - h.pluckAt) / (h.releaseAt - h.pluckAt)));
    if (u >= 1) {
      a.cycle = false;
      wk.aim = null;
      wk.pickU = 0;
    }
  }

  /** Done with this plant: carry on to a different kind of fruit, or take the basket in once it is as full as they wanted. */
  private nextStop(wk: Walker) {
    const a = wk.act, b = wk.basket;
    if (a?.kind !== 'harvest' || !b) return;
    // As full as they wanted, or no room for another pick of the kind they were picking.
    const here = this.world.harvest.find((q) => q.id === a.plant);
    if (b.used >= a.final - 1e-9 || (here && b.used + pickBulkFt3(here, this.cfg.harvest) > b.volume + 1e-9)) return this.finishHarvest(wk);
    const options = this.world.harvest
      .filter((q) => !a.species.includes(q.speciesId))
      .map((q) => ({ q, d: Math.hypot(q.x - wk.x, q.y - wk.y) }))
      .sort((p, r) => p.d - r.d);
    for (const { q } of options) {
      const stand = this.harvestStand(wk, q);
      const route = stand ? findRoute(this.world, [wk.x, wk.y], stand) : null;
      if (!stand || !route) continue;
      a.plant = q.id;
      a.stand = stand;
      a.phase = 'to';
      a.t = 0;
      a.cycle = false;
      a.fired = false;
      wk.aim = null;
      wk.pickU = 0;
      a.species.push(q.speciesId);
      wk.route = route.slice(1);
      if (route.length <= 1) this.arrive(wk);
      return;
    }
    this.finishHarvest(wk); // nothing different left to pick
  }

  /** Walk the basket to the nearest door and go in; with no door to go in by, just put it down. */
  private finishHarvest(wk: Walker) {
    const self = this.walkers.indexOf(wk);
    this.flights = this.flights.filter((f) => f.walker !== self);
    wk.act = null;
    wk.pickU = 0;
    wk.aim = null;
    wk.route = [];
    wk.speed = 0;
    const doors = this.world.doors;
    if (!wk.basket || wk.basket.items.length === 0 || doors.length === 0) {
      this.dropBasket(wk);
      return;
    }
    const door = doors.reduce((best, d) => (Math.hypot(d.approach[0] - wk.x, d.approach[1] - wk.y) < Math.hypot(best.approach[0] - wk.x, best.approach[1] - wk.y) ? d : best));
    const route = findRoute(this.world, [wk.x, wk.y], door.approach);
    if (!route) {
      this.dropBasket(wk);
      return;
    }
    wk.visit = { door: door.id, phase: 'to', left: 0 };
    wk.route = route.slice(1);
    if (route.length <= 1) this.startEntering(wk);
  }

  private dropBasket(wk: Walker) {
    const self = this.walkers.indexOf(wk);
    this.flights = this.flights.filter((f) => f.walker !== self);
    wk.basket = null;
    wk.pickU = 0;
    wk.aim = null;
  }

  /** Fruit let go over the basket (the pick has carried it all the way) lands in it. */
  private stepFlights(_dt: number) {
    if (this.flights.length === 0) return;
    const still: Flight[] = [];
    for (const f of this.flights) {
      const b = this.walkers[f.walker]?.basket;
      if (!b) continue;
      if (f.p >= 1) { b.items.push({ color: f.color, d: f.d, aspect: f.aspect }); b.used += f.bulk; }
      else still.push(f);
    }
    this.flights = still;
  }


  // -------------------------------------------------------------------------------------------
  // Manner: idle moments, glances, smiles, greetings and play, so people read as people
  // -------------------------------------------------------------------------------------------

  private leanSpots: LeanSpot[] | null = null;

  /** Places to lean on a building's wall: reachable ground close to a wall, away from doors. */
  private leans(): LeanSpot[] {
    if (this.leanSpots) return this.leanSpots;
    const w = this.world, reach = this.cfg.margins.structureFt + 1.2;
    const out: LeanSpot[] = [];
    let n = 0;
    for (const k of w.reachable) {
      if (n++ % 3) continue;
      const [x, y] = center(w, k % w.nx, Math.floor(k / w.nx));
      let best: { d: number; pt: Pt } | null = null;
      for (const st of w.structures) {
        const d = distanceToPolygon(x, y, st);
        if (d <= reach && (!best || d < best.d)) best = { d, pt: nearestOnPolygon(st, x, y) };
      }
      if (!best || w.doors.some((dr) => Math.hypot(dr.stand[0] - x, dr.stand[1] - y) < 4)) continue;
      const face = Math.atan2(y - best.pt[1], x - best.pt[0]);
      // Where the body would rest must be clear of every building part (two parts that meet make an inside corner, not a wall).
      const bx = best.pt[0] + Math.cos(face) * 0.6, by = best.pt[1] + Math.sin(face) * 0.6;
      if (w.structures.some((st) => pointInPolygon(bx, by, st) || distanceToPolygon(bx, by, st) < 0.45)) continue;
      out.push({ stand: [x, y], wall: best.pt, face });
    }
    this.leanSpots = out;
    return out;
  }

  /** Open ground a little way from a plant's canopy, nearest to this person, not crowded or claimed. */
  private standNear(wk: Walker, x: number, y: number, r: number): Pt | null {
    const w = this.world, off = this.cfg.people.manner.linger.standOffFt;
    let best: Pt | null = null, bestD = Infinity;
    for (const k of w.reachable) {
      const c = center(w, k % w.nx, Math.floor(k / w.nx));
      const d = Math.hypot(c[0] - x, c[1] - y);
      if (d < r + 1.2 || d > r + off + 1.2) continue;
      if (this.crowded(c[0], c[1], wk) || this.claimed(c[0], c[1], wk)) continue;
      const near = Math.hypot(c[0] - wk.x, c[1] - wk.y);
      if (near < bestD) { bestD = near; best = c; }
    }
    return best;
  }

  /** Someone with a free moment stops: looks at a plant, gazes up, checks a phone, smells a flower, leans on a wall, perches on a bed, eats a piece of fruit, or spins. */
  private startLinger(wk: Walker): boolean {
    const M = this.cfg.people.manner, L = M.linger, w = this.world;
    if (wk.kind !== 'person' || this.night) return false;
    const near = <T extends { x: number; y: number }>(list: T[]): T[] =>
      list.map((o) => ({ o, d: Math.hypot(o.x - wk.x, o.y - wk.y) })).filter((e) => e.d <= L.searchFt).sort((a, b) => a.d - b.d).slice(0, 4).map((e) => e.o);
    const plants = near(w.plants.map((p) => ({ x: p.x, y: p.y, radius: p.r })));
    const blooms = near(w.blooms), fruit = near(w.harvest);
    const rims = w.rims.map((r, i) => ({ r, i })).filter(({ r, i }) => !this.seatTaken.has(`rim:${i}`) && Math.hypot(r.x - wk.x, r.y - wk.y) <= L.searchFt);
    const leans = this.leans().filter((l) => Math.hypot(l.stand[0] - wk.x, l.stand[1] - wk.y) <= L.searchFt);
    const kind = pickWeighted(lingerOptions(M, { age: wk.age, energy: wk.pers.energy, curious: wk.pers.curious }, { look: plants.length > 0, smell: blooms.length > 0, snack: fruit.length > 0, perch: rims.length > 0, lean: leans.length > 0 }), this.rng());
    if (!kind) return false;
    const pick = <T,>(list: T[]): T => list[Math.floor(this.rng() * list.length)];
    let spot: Pt | null = [wk.x, wk.y], face: Pt | null = null, rim: Rim | null = null, lean: LeanSpot | null = null, color: string | null = null;
    if (kind === 'look') { const p = pick(plants); spot = this.standNear(wk, p.x, p.y, p.radius); face = [p.x, p.y]; }
    else if (kind === 'smell') { const b = pick(blooms); spot = this.standNear(wk, b.x, b.y, b.radius); face = [b.x, b.y]; }
    else if (kind === 'snack') { const f = pick(fruit); spot = this.standNear(wk, f.x, f.y, f.radius); face = [f.x, f.y]; color = f.color; }
    else if (kind === 'lean') { lean = pick(leans); spot = lean.stand; }
    else if (kind === 'perch') { const e = pick(rims); rim = e.r; spot = this.nearestFree(e.r.out[0], e.r.out[1]); this.seatTaken.set(`rim:${e.i}`, this.walkers.indexOf(wk)); }
    const release = () => { if (rim) this.seatTaken.delete(`rim:${w.rims.indexOf(rim)}`); };
    if (!spot) { release(); return false; }
    const here = spot[0] === wk.x && spot[1] === wk.y;
    // Stopping on the spot: only with nobody close by (a spin needs arm's length all round).
    if (here) {
      const clear = this.bodyR(wk) * 2 + this.cfg.people.spaceFt + (kind === 'spin' ? 2 : 0.8);
      if (this.walkers.some((o) => o !== wk && o.kind === 'person' && !o.away && !isInside(o) && Math.hypot(o.x - wk.x, o.y - wk.y) < clear)) { release(); return false; }
    }
    const route = here ? [[wk.x, wk.y] as Pt] : findRoute(w, [wk.x, wk.y], spot);
    if (!route) { release(); return false; }
    const turns = Math.round(this.between(L.spinTurns));
    const left = kind === 'spin' ? this.between(L.sec.spin) * Math.max(1, turns) : this.between(L.sec[kind]);
    const act: Extract<Act, { kind: 'linger' }> = { kind: 'linger', what: kind, phase: here || route.length <= 1 ? 'do' : 'to', spot, face, left, t: 0, rim, lean, color, turns };
    wk.act = act;
    wk.route = route.slice(1);
    wk.pauseLeft = 0;
    if (act.phase === 'do') this.beginLinger(wk, act);
    return true;
  }

  /** They are where they were going: settle in (onto the bed's rim, against the wall) and face the right way. */
  private beginLinger(wk: Walker, a: Extract<Act, { kind: 'linger' }>) {
    wk.route = [];
    wk.speed = 0;
    wk.poseT = 0;
    // Perching and leaning put the body on a spot a step or two away; if somebody is standing there, give the idea up instead of
    // popping into their body.
    const taken = (x: number, y: number) => this.walkers.some((o) => o !== wk && o.kind === 'person' && !o.away && !isInside(o) && Math.hypot(o.x - x, o.y - y) < this.bodyR(wk) + this.bodyR(o) + 0.2);
    if (a.what === 'perch' && a.rim) {
      if (taken(a.rim.x, a.rim.y)) return this.endAct(wk);
      wk.x = a.rim.x;
      wk.y = a.rim.y;
      wk.seatZ = a.rim.z;
    } else if (a.what === 'lean' && a.lean) {
      const lx = a.lean.wall[0] + Math.cos(a.lean.face) * 0.6, ly = a.lean.wall[1] + Math.sin(a.lean.face) * 0.6;
      if (taken(lx, ly)) return this.endAct(wk);
      wk.x = lx;
      wk.y = ly;
    } else if (a.what === 'sky') wk.heading += (this.rng() - 0.5) * 1.5;
  }

  private stepLinger(wk: Walker, dt: number) {
    const a = wk.act as Extract<Act, { kind: 'linger' }>;
    const L = this.cfg.people.manner.linger;
    a.t += dt;
    wk.poseT += dt;
    wk.speed = 0;
    if (this.night || a.t >= a.left) {
      this.endAct(wk);
      return;
    }
    const u = a.t / a.left;
    const toward = (p: Pt | null) => { if (p) this.faceToward(wk, p[0], p[1], dt); };
    switch (a.what) {
      case 'look':
        toward(a.face);
        wk.headTurn = approach(wk.headTurn, Math.sin(this.clock * 0.7 + wk.variant) * 0.25, 2, dt);
        break;
      case 'sky':
        wk.lookUp = true;
        wk.heading += Math.sin(this.clock * 0.35 + wk.variant) * 0.12 * dt;
        break;
      case 'phone':
        wk.pose = 'phone';
        wk.headPitch = approach(wk.headPitch, L.phoneHeadDown, 2.5, dt);
        break;
      case 'smell': {
        toward(a.face);
        const k = Math.max(0, Math.min(1, u / 0.2, (1 - u) / 0.15));
        wk.bend = approach(wk.bend, L.bendSmell * k, 3, dt);
        wk.headPitch = approach(wk.headPitch, 0.2 * k, 3, dt);
        break;
      }
      case 'lean':
        if (a.lean) wk.heading += Math.atan2(Math.sin(a.lean.face - wk.heading), Math.cos(a.lean.face - wk.heading)) * Math.min(1, dt * 4);
        wk.pose = 'folded';
        wk.bend = approach(wk.bend, -0.1, 2, dt);
        this.stepGaze(wk, dt);
        break;
      case 'perch': {
        if (a.rim) wk.heading += Math.atan2(Math.sin(a.rim.face - wk.heading), Math.cos(a.rim.face - wk.heading)) * Math.min(1, dt * 4);
        wk.sit = Math.max(0, Math.min(1, a.t / L.sitSeconds, (a.left - a.t) / L.sitSeconds));
        this.stepGaze(wk, dt);
        break;
      }
      case 'snack':
        toward(a.face);
        wk.pose = 'snack';
        wk.snackColor = a.color;
        break;
      case 'spin':
        wk.heading += ((a.turns * Math.PI * 2) / a.left) * dt;
        wk.pose = 'spin';
        break;
      case 'puppet':
        toward(a.face);
        wk.pose = 'puppet';
        break;
    }
  }

  /** What a walker might look at now: someone near, a dog, a bee, a flower. */
  private glanceOptions(wk: Walker): { item: NonNullable<Walker['glance']>; w: number }[] {
    const g = this.cfg.people.manner.gaze;
    const out: { item: NonNullable<Walker['glance']>; w: number }[] = [];
    const self = this.walkers.indexOf(wk);
    this.walkers.forEach((o, i) => {
      if (i === self || o.away || isInside(o)) return;
      const d = Math.hypot(o.x - wk.x, o.y - wk.y);
      if (o.kind === 'person' && d <= g.rangeFt) out.push({ item: { kind: 'person', x: o.x, y: o.y, who: i, left: 0 }, w: 0.4 + wk.pers.social });
      else if (o.kind === 'dog' && d <= g.dogRangeFt) out.push({ item: { kind: 'dog', x: o.x, y: o.y, who: i, left: 0 }, w: 1 });
    });
    for (const b of this.bees) if (b.phase !== 'rest' && Math.hypot(b.x - wk.x, b.y - wk.y) <= g.beeRangeFt) out.push({ item: { kind: 'bee', x: b.x, y: b.y, who: -1, left: 0 }, w: 0.5 });
    for (const b of this.world.blooms) if (Math.hypot(b.x - wk.x, b.y - wk.y) <= g.bloomRangeFt) out.push({ item: { kind: 'bloom', x: b.x, y: b.y, who: -1, left: 0 }, w: 0.3 + wk.pers.curious * 1.2 });
    return out;
  }

  /** The head: glances at what is near now and then (and waves at a person passing), otherwise looks where they are going. */
  private stepGaze(wk: Walker, dt: number) {
    const M = this.cfg.people.manner, g = M.gaze;
    wk.gazeTick -= dt;
    wk.glanceCool -= dt;
    if (wk.glance) {
      wk.glance.left -= dt;
      const o = wk.glance.who >= 0 ? this.walkers[wk.glance.who] : null;
      if (o) { wk.glance.x = o.x; wk.glance.y = o.y; }
      if (wk.glance.left <= 0 || (o && (o.away || isInside(o)))) {
        wk.glance = null;
        wk.glanceCool = this.between(g.glanceCoolS);
      }
    } else if (wk.glanceCool <= 0 && wk.gazeTick <= 0) {
      wk.gazeTick = g.tickS;
      if (this.rng() < g.glanceBias * 0.5) {
        const pick = pickWeighted(this.glanceOptions(wk), this.rng());
        if (pick) {
          wk.glance = { ...pick, left: this.between(g.glanceS) };
          const o = pick.who >= 0 ? this.walkers[pick.who] : null;
          // Someone passing: sometimes a wave, and sometimes it is returned.
          if (o && o.kind === 'person' && wk.greetCool <= 0 && Math.hypot(o.x - wk.x, o.y - wk.y) <= M.greet.passRangeFt && this.rng() < M.greet.waveChance * (0.3 + wk.pers.social)) {
            wk.wave = M.greet.waveS;
            wk.greetCool = M.greet.cool;
            if (o.greetCool <= 0 && !o.act && this.rng() < 0.6) {
              o.wave = M.greet.waveS * 0.9;
              o.greetCool = M.greet.cool;
              o.glance = { kind: 'person', x: wk.x, y: wk.y, who: this.walkers.indexOf(wk), left: M.greet.waveS };
            }
          }
        }
      }
    }
    let turn = 0;
    if (wk.glance) turn = headTurnToward(wk.heading, wk.x, wk.y, wk.glance.x, wk.glance.y, g.maxTurn);
    else if (wk.route.length) {
      const ahead = wk.route[Math.min(wk.route.length - 1, 2)];
      turn = headTurnToward(wk.heading, wk.x, wk.y, ahead[0], ahead[1], g.maxTurn) * 0.6;
    }
    wk.headTurn = approach(wk.headTurn, turn, g.rate, dt);
  }

  /** Ease the face and body back to neutral when nothing is holding a pose. */
  private relax(wk: Walker, dt: number) {
    const a = wk.act;
    if (a?.kind !== 'linger') {
      if (wk.pose !== 'tag') wk.pose = 'none';
      wk.bend = approach(wk.bend, 0, 3, dt);
      wk.headPitch = approach(wk.headPitch, 0, 3, dt);
      if (wk.pose === 'none') wk.snackColor = null;
    }
    wk.wave = Math.max(0, wk.wave - dt);
    wk.shoo = Math.max(0, wk.shoo - dt);
    // Done waving at someone in the light: the head comes back to the screen.
    if (wk.shoo <= 0 && a?.kind === 'watch') wk.headTurn = approach(wk.headTurn, 0, 3, dt);
    wk.greetCool -= dt;
    wk.playCool -= dt;
    if (wk.skip > 0) wk.skip -= dt;
  }

  /** A smile that follows what they are doing: a pleasant default (more for the sociable), more with company, a hug, play or a bite of fruit. */
  private stepSmile(wk: Walker, dt: number) {
    const S = this.cfg.people.manner.smile;
    const a = wk.act;
    let t = S.base + S.baseSocial * wk.pers.social;
    if (wk.hug > 0.3) t = S.hug;
    else if (wk.cheer) t = S.cheer;
    else if (wk.five > 0.05 || wk.wave > 0) t = S.meet;
    else if (a?.kind === 'meet') t = a.phase === 'talk' ? S.talk : S.meet;
    else if (a?.kind === 'chase' || wk.skip > 0 || wk.pose === 'spin' || wk.pose === 'puppet') t = S.play;
    else if (wk.pose === 'snack') t = S.snack;
    else if (wk.talking || (a?.kind === 'dine' && a.phase === 'talk')) t = S.talk;
    else if (wk.glance && wk.glance.kind !== 'bee') t = Math.max(t, S.glance * (0.5 + wk.pers.social * 0.5));
    wk.smile = approach(wk.smile, t, S.rate, dt);
  }

  /** Walk the route's next leg at a speed, going round people; false when held up or the route is spent. */
  private follow(wk: Walker, dt: number, speed: number): boolean {
    const next = wk.route[0];
    if (!next) { wk.speed = 0; return false; }
    const dx = next[0] - wk.x, dy = next[1] - wk.y, dist = Math.hypot(dx, dy);
    let diff = Math.atan2(dy, dx) - wk.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = this.cfg.people.turnRate * dt;
    wk.heading += Math.max(-turn, Math.min(turn, diff));
    const move = Math.min(dist, speed * (Math.abs(diff) > 1.2 ? 0.5 : 1) * dt);
    const adj = this.avoid(wk, wk.x + (dx / (dist || 1)) * move, wk.y + (dy / (dist || 1)) * move);
    if (!adj) { wk.speed = 0; this.heldUp(wk, dt); return false; }
    wk.blockedS = 0;
    if (this.world.blocked[idx(this.world, ...cellOf(this.world, adj[0], adj[1]))]) { wk.route = []; return false; }
    wk.x = adj[0];
    wk.y = adj[1];
    wk.speed = move / dt;
    wk.gait += move * (Math.PI / wk.stepFt);
    this.checkHeadway(wk, dt);
    if (dist - move < 0.25) wk.route.shift();
    return true;
  }

  /** A kid or teen picks someone to chase: tag. */
  private startChase(wk: Walker): boolean {
    const P = this.cfg.people.manner.play;
    if (wk.kind !== 'person' || wk.leader !== null || this.night) return false;
    const self = this.walkers.indexOf(wk);
    const near = this.walkers.map((o, i) => ({ o, i, d: Math.hypot(o.x - wk.x, o.y - wk.y) }))
      .filter(({ o, i, d }) => i !== self && o.kind === 'person' && !o.away && !isInside(o) && o.age >= 6 && !(o.act?.kind === 'dine' || o.act?.kind === 'cake') && d >= 6 && d <= P.chaseRangeFt);
    if (!near.length) return false;
    const t = near[Math.floor(this.rng() * near.length)];
    wk.act = { kind: 'chase', phase: 'run', target: t.i, left: this.between(P.chaseS), t: 0, replan: 0 };
    wk.route = [];
    wk.pauseLeft = 0;
    // The one being chased notices, and laughs.
    t.o.glance = { kind: 'person', x: wk.x, y: wk.y, who: self, left: 2.5 };
    return true;
  }

  private stepChase(wk: Walker, dt: number) {
    const a = wk.act as Extract<Act, { kind: 'chase' }>;
    const P = this.cfg.people.manner.play;
    const tgt = this.walkers[a.target];
    const stop = () => { this.endAct(wk); wk.playCool = P.cooldownS; };
    if (!tgt || tgt.away || isInside(tgt) || this.night) return stop();
    a.t += dt;
    if (a.phase === 'tag') {
      a.left -= dt;
      wk.speed = 0;
      wk.pose = 'tag';
      this.faceToward(wk, tgt.x, tgt.y, dt);
      if (a.left <= 0) stop();
      return;
    }
    if (a.t >= a.left) return stop();
    const reach = this.bodyR(wk) + this.bodyR(tgt) + this.cfg.people.spaceFt + P.tagReachFt;
    if (Math.hypot(tgt.x - wk.x, tgt.y - wk.y) <= reach) {
      a.phase = 'tag';
      a.left = P.tagS;
      wk.speed = 0;
      tgt.wave = 0;
      tgt.glance = { kind: 'person', x: wk.x, y: wk.y, who: this.walkers.indexOf(wk), left: 2 };
      // Tag, you're it: a kid or teen turns and gives chase.
      if (tgt.age >= P.minAge && tgt.age <= P.maxAge && !tgt.act && !tgt.visit && tgt.leader === null && this.rng() < P.chaseBackChance) {
        tgt.act = { kind: 'chase', phase: 'run', target: this.walkers.indexOf(wk), left: this.between(P.chaseS), t: 0, replan: 0 };
        tgt.route = [];
        tgt.pauseLeft = 0;
      }
      return;
    }
    a.replan -= dt;
    if (a.replan <= 0 || wk.route.length === 0) {
      const route = findRoute(this.world, [wk.x, wk.y], [tgt.x, tgt.y]);
      wk.route = route ? route.slice(1) : [];
      a.replan = P.replanS;
      if (!route) return stop();
    }
    this.follow(wk, dt, wk.cruise * P.chaseSpeedMul);
  }


  // -------------------------------------------------------------------------------------------
  // The projector's light: shadows on the screen, and everyone's reaction to them
  // -------------------------------------------------------------------------------------------

  /** The shadows now on the screen, in the wall's coordinates (y along it, z up), for the scene to paint. */
  screenShadows: Disc[] = [];
  private shadowClock = 0;

  /** Crossing the projector's beam costs extra while a film shows, and not otherwise. */
  private syncBeam() {
    this.world.beamOn = this.movieOn && !!this.world.beamCost;
    if (!this.movieOn) this.screenShadows = [];
  }

  /** Someone who is part of something and will not be told to move: sitting at a table, in a meeting, picking fruit. */
  private committed(wk: Walker): boolean {
    const k = wk.act?.kind;
    return k === 'dine' || k === 'cake' || k === 'meet' || k === 'harvest' || wk.visit !== null;
  }

  /**
   * While a film shows, everyone between the projector and the screen throws a shadow on it (worked out from balls for their
   * bodies and the light's real position). Whoever has been in the light for `complainAfterS` seconds is waved at by the nearest
   * people, who keep waving until they leave it; the one in the light takes a moment to notice (kids, forgetful, longer) and then
   * walks out of the beam.
   */
  private stepProjector(dt: number) {
    const sc = this.world.screen, sh = this.cfg.movie.shadow;
    if (!this.movieOn || !sc) {
      if (this.screenShadows.length) this.screenShadows = [];
      for (const wk of this.walkers) { wk.shadowS = 0; wk.shoo = 0; wk.shooAt = -1; wk.reactT = null; }
      return;
    }
    this.shadowClock += dt;
    if (this.shadowClock < sh.tickS) return;
    const tick = this.shadowClock;
    this.shadowClock = 0;
    const rect = { y0: sc.y - sc.width / 2, y1: sc.y + sc.width / 2, z0: sc.bottom, z1: sc.bottom + sc.height };
    const all: Disc[] = [];
    const offenders: number[] = [];
    this.walkers.forEach((wk, i) => {
      if (wk.away || isInside(wk)) { wk.shadowS = 0; return; }
      const spheres = wk.kind === 'person' ? personSpheres(wk.x, wk.y, wk.heading, wk.heightFt, wk.pose === 'puppet') : dogSpheres(wk.x, wk.y, wk.heading, wk.heightFt);
      const discs = castOnWall(spheres, sc.lens, sc.x);
      all.push(...discs);
      if (wk.kind !== 'person') return;
      const blocks = coverage(discs, rect) >= sh.coverMin && !this.committed(wk);
      wk.shadowS = blocks ? wk.shadowS + tick : 0;
      if (!blocks) wk.reactT = null;
      else if (wk.shadowS >= sh.complainAfterS) offenders.push(i);
    });
    this.screenShadows = all;
    for (const i of offenders) {
      const off = this.walkers[i];
      // The nearest people wave at them: viewers first, then anyone free within range.
      const near = this.walkers
        .map((o, j) => ({ o, j, d: Math.hypot(o.x - off.x, o.y - off.y) }))
        .filter(({ o, j, d }) => j !== i && o.kind === 'person' && !o.away && !isInside(o) && d <= sh.shooRangeFt && !offenders.includes(j) && o.act?.kind !== 'chase' && !this.committed(o))
        .sort((a, b) => Number(b.o.act?.kind === 'watch') - Number(a.o.act?.kind === 'watch') || a.d - b.d)
        .slice(0, sh.maxShooers);
      for (const { o, j } of near) {
        o.shoo = sh.shooRefreshS;
        o.shooAt = i;
        o.headTurn = approach(o.headTurn, headTurnToward(o.heading, o.x, o.y, off.x, off.y, this.cfg.people.manner.gaze.maxTurn), 6, tick);
        void j;
      }
      // Once waved at, they take a moment to notice, and then step out of the light.
      if (off.reactT === null) off.reactT = this.between(ageGroup(off.age) === 'kid' ? sh.kidReactS : sh.reactS);
      off.reactT -= tick;
      if (off.reactT <= 0) this.dodge(off);
    }
  }

  /** Step out of the projector's beam by the shortest way, then carry on. */
  private dodge(wk: Walker) {
    const sc = this.world.screen, sh = this.cfg.movie.shadow;
    if (!sc) return;
    const tri = beamTriangle(sc.lens, sc.x, sc.y - sc.width / 2, sc.y + sc.width / 2);
    let best: Pt | null = null, bestD = Infinity;
    for (const k of this.world.reachable) {
      const c = center(this.world, k % this.world.nx, Math.floor(k / this.world.nx));
      const d = Math.hypot(c[0] - wk.x, c[1] - wk.y);
      if (d >= bestD || inBeam(c[0], c[1], tri, sh.dodgeMarginFt) || this.crowded(c[0], c[1], wk) || this.claimed(c[0], c[1], wk)) continue;
      best = c;
      bestD = d;
    }
    if (!best) return;
    const route = findRoute(this.world, [wk.x, wk.y], best);
    if (!route) return;
    if (wk.act) this.endAct(wk);
    wk.act = { kind: 'dodge', phase: 'to', spot: best };
    wk.route = route.slice(1);
    wk.pauseLeft = 0;
    wk.reactT = null;
    if (route.length <= 1) this.arrive(wk);
  }

  /** A kid or teen steps into the beam on purpose, to make shadow puppets on the screen. */
  private startPuppet(wk: Walker): boolean {
    const sc = this.world.screen, P = this.cfg.movie.shadow.puppet;
    if (!sc || !this.movieOn || wk.kind !== 'person' || wk.leader !== null || wk.age < P.minAge || wk.age > P.maxAge || this.committed(wk)) return false;
    const w = this.world;
    let best: Pt | null = null, bestD = Infinity;
    for (const k of w.reachable) {
      if (!w.beamCells || !w.beamCells[k]) continue;
      const c = center(w, k % w.nx, Math.floor(k / w.nx));
      const out = c[0] - sc.x;
      if (out < P.wallFt[0] || out > P.wallFt[1] || Math.abs(c[1] - sc.y) > sc.width * 0.35) continue;
      const d = Math.hypot(c[0] - wk.x, c[1] - wk.y);
      if (d >= bestD || this.crowded(c[0], c[1], wk) || this.claimed(c[0], c[1], wk)) continue;
      best = c;
      bestD = d;
    }
    if (!best) return false;
    const route = findRoute(w, [wk.x, wk.y], best);
    if (!route) return false;
    const act: Extract<Act, { kind: 'linger' }> = { kind: 'linger', what: 'puppet', phase: route.length <= 1 ? 'do' : 'to', spot: best, face: [sc.x, sc.y], left: this.between(P.sec), t: 0, rim: null, lean: null, color: null, turns: 1 };
    wk.act = act;
    wk.route = route.slice(1);
    wk.pauseLeft = 0;
    if (act.phase === 'do') this.beginLinger(wk, act);
    return true;
  }

  private findSeat(id: string): WorldSeat | null {
    for (const t of this.world.tables) {
      const s = t.seats.find((q) => q.id === id);
      if (s) return s;
    }
    return null;
  }

  private idle(wk: Walker): boolean {
    return wk.kind === 'person' && wk.leader === null && !wk.act && !wk.visit;
  }

  /** Stop what they were doing at a table or the screen: stand, push the chair in, and wander off. */
  private endAct(wk: Walker) {
    const a = wk.act;
    if (a?.kind === 'dine') {
      this.seatTaken.delete(a.seat);
      this.chairs.set(a.seat, 0);
    }
    if (a?.kind === 'cake') this.seatTaken.delete(a.seat);
    if (a?.kind === 'harvest') this.dropBasket(wk);
    if (a?.kind === 'linger' && a.rim) this.seatTaken.delete(`rim:${this.world.rims.indexOf(a.rim)}`);
    if (a?.kind === 'meet') {
      wk.hug = 0;
      wk.meetCool = this.cfg.people.meet.cooldownS;
    }
    wk.cheer = false;
    wk.lookUp = false;
    wk.pose = 'none';
    wk.reactT = null;
    wk.bend = 0;
    wk.headPitch = 0;
    wk.five = 0;
    wk.snackColor = null;
    wk.seatZ = null;
    wk.act = null;
    wk.sit = 0;
    wk.talking = false;
    wk.headTurn = 0;
    wk.route = [];
    wk.speed = 0;
    wk.pauseLeft = this.between(this.cfg.people.pauseS) * 0.5;
    const [i, j] = cellOf(this.world, wk.x, wk.y);
    if (this.world.blocked[idx(this.world, i, j)]) {
      const p = this.nearestFree(wk.x, wk.y, wk);
      if (p) [wk.x, wk.y] = p;
    }
  }

  /** Where someone with an act is heading while they walk there. */
  private actTarget(wk: Walker): Pt | null {
    const a = wk.act;
    if (!a) return null;
    if (a.kind === 'watch') return a.spot;
    if (a.kind === 'harvest') return a.stand;
    if (a.kind === 'meet') return a.spot;
    if (a.kind === 'linger' || a.kind === 'dodge') return a.spot;
    if (a.kind === 'chase') return null;
    return this.findSeat(a.seat)?.approach ?? null; // a chair or a place at the cake
  }

  /** They have walked to the chair or the viewing spot: start the next part. */
  private arrive(wk: Walker) {
    const a = wk.act;
    if (!a) return;
    wk.route = [];
    wk.speed = 0;
    if (a.kind === 'watch') {
      a.phase = 'watch';
      return;
    }
    if (a.kind === 'meet') {
      a.phase = 'wait';
      a.t = 0;
      return;
    }
    if (a.kind === 'linger') {
      a.phase = 'do';
      a.t = 0;
      this.beginLinger(wk, a);
      return;
    }
    if (a.kind === 'dodge') {
      this.endAct(wk);
      return;
    }
    if (a.kind === 'chase') return;
    if (a.kind === 'harvest') {
      a.phase = 'pick';
      a.t = 0;
      a.cycle = false;
      a.fired = false;
      a.chunk = this.chunkFor(wk);
      return;
    }
    if (a.kind === 'cake') {
      const place = this.findSeat(a.seat);
      if (!place) return this.endAct(wk);
      wk.x = place.approach[0];
      wk.y = place.approach[1];
      a.phase = 'gather';
      return;
    }
    const seat = this.findSeat(a.seat);
    if (!seat) {
      this.endAct(wk);
      return;
    }
    wk.x = seat.approach[0];
    wk.y = seat.approach[1];
    a.phase = 'pull';
    a.t = 0;
  }

  private setPull(id: string, v: number) {
    this.chairs.set(id, Math.max(0, Math.min(1, v)));
  }

  /** The pose of someone at a table: pulling the chair out, sitting down, talking, standing up, pushing it in. */
  private stepDine(wk: Walker, dt: number) {
    const a = wk.act as Extract<Act, { kind: 'dine' }>;
    const seat = this.findSeat(a.seat);
    if (!seat) {
      this.endAct(wk);
      return;
    }
    const c = this.cfg.dining;
    const ease = (u: number) => u * u * (3 - 2 * u);
    const chairAt = (pull: number): Pt => [seat.chair[0] + seat.out[0] * c.pullFt * pull, seat.chair[1] + seat.out[1] * c.pullFt * pull];
    a.t += dt;
    wk.speed = 0;
    wk.heading = seat.facing;
    switch (a.phase) {
      case 'pull': {
        wk.x = seat.approach[0];
        wk.y = seat.approach[1];
        this.setPull(seat.id, a.t / c.pullS);
        if (a.t >= c.pullS) { a.phase = 'sit'; a.t = 0; }
        break;
      }
      case 'sit': {
        const u = ease(Math.min(1, a.t / c.sitS));
        const pull = 1 - (1 - c.scootShare) * u;
        this.setPull(seat.id, pull);
        const seatPos = chairAt(pull);
        wk.x = seat.approach[0] + (seatPos[0] - seat.approach[0]) * u;
        wk.y = seat.approach[1] + (seatPos[1] - seat.approach[1]) * u;
        wk.sit = u;
        if (a.t >= c.sitS) { a.phase = 'talk'; a.t = 0; a.left = this.between(c.talkS); }
        break;
      }
      case 'talk': {
        this.setPull(seat.id, c.scootShare);
        [wk.x, wk.y] = chairAt(c.scootShare);
        wk.sit = 1;
        a.left -= dt;
        if (a.left <= 0) { a.phase = 'rise'; a.t = 0; wk.talking = false; wk.headTurn = 0; }
        break;
      }
      case 'rise': {
        const u = ease(Math.min(1, a.t / c.riseS));
        const pull = c.scootShare + (1 - c.scootShare) * u;
        this.setPull(seat.id, pull);
        const seatPos = chairAt(c.scootShare + (1 - c.scootShare) * Math.min(1, u * 1.2));
        wk.x = seatPos[0] + (seat.approach[0] - seatPos[0]) * u;
        wk.y = seatPos[1] + (seat.approach[1] - seatPos[1]) * u;
        wk.sit = 1 - u;
        if (a.t >= c.riseS) { a.phase = 'push'; a.t = 0; wk.sit = 0; }
        break;
      }
      case 'push': {
        wk.x = seat.approach[0];
        wk.y = seat.approach[1];
        this.setPull(seat.id, 1 - a.t / c.pushS);
        if (a.t >= c.pushS) this.endAct(wk);
        break;
      }
      default:
        break;
    }
  }

  /** Watching: turn to face the screen and stand there until the movie is over. */
  private stepWatch(wk: Walker, dt: number) {
    const a = wk.act as Extract<Act, { kind: 'watch' }>;
    if (a.sky) {
      // The display is beyond the back of the lot: face it, head tipped back, and cheer at the bigger bursts now and then.
      if (!this.fireworksOn) {
        this.endAct(wk);
        return;
      }
      const want = Math.PI / 2;
      let diff = want - wk.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turn = this.cfg.people.turnRate * dt;
      wk.heading += Math.max(-turn, Math.min(turn, diff));
      wk.speed = 0;
      wk.lookUp = true;
      wk.cheer = Math.sin(this.clock * 0.9 + wk.variant) > 0.82;
      return;
    }
    const sc = this.world.screen;
    if (!sc || !this.movieOn) {
      this.endAct(wk);
      return;
    }
    const want = Math.atan2(sc.y - wk.y, sc.x - wk.x);
    let diff = want - wk.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = this.cfg.people.turnRate * dt;
    wk.heading += Math.max(-turn, Math.min(turn, diff));
    wk.speed = 0;
  }

  /** At each table, one of those sitting talks while the others look at them, and who talks changes every few seconds. */
  private stepTables(dt: number) {
    const c = this.cfg.dining;
    for (const t of this.world.tables) {
      const sitters = this.walkers.filter((wk) => wk.act?.kind === 'dine' && wk.act.phase === 'talk' && t.seats.some((s) => s.id === (wk.act as { seat: string }).seat));
      if (sitters.length < 2) {
        for (const wk of sitters) { wk.talking = false; wk.headTurn = 0; }
        this.tableTalk.delete(t.id);
        continue;
      }
      const state = this.tableTalk.get(t.id) ?? { speaker: -1, left: 0 };
      state.left -= dt;
      if (state.left <= 0 || !sitters.some((_, n) => this.walkers.indexOf(sitters[n]) === state.speaker)) {
        state.speaker = this.walkers.indexOf(sitters[Math.floor(this.rng() * sitters.length)]);
        state.left = this.between(c.speakerS);
      }
      this.tableTalk.set(t.id, state);
      const speaker = this.walkers[state.speaker];
      for (const wk of sitters) {
        if (wk === speaker) {
          wk.talking = true;
          wk.headTurn = Math.sin(this.clock * 1.3 + state.speaker) * 0.35;
        } else {
          wk.talking = false;
          let d = Math.atan2(speaker.y - wk.y, speaker.x - wk.x) - wk.heading;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          wk.headTurn = Math.max(-c.headTurnMax, Math.min(c.headTurnMax, d));
        }
      }
    }
  }


  /** Crowded round the table for the cake: standing close, facing it, cheering, until the cake is put away. */
  private stepCake(wk: Walker) {
    const a = wk.act as Extract<Act, { kind: 'cake' }>;
    const place = this.findSeat(a.seat);
    if (!place || !this.cake) {
      this.endAct(wk);
      return;
    }
    wk.heading = place.facing;
    wk.speed = 0;
    wk.cheer = true;
  }

  /** The cake comes out: nearly everyone heads for a place round the table. */
  private gatherCake() {
    for (const wk of this.walkers) {
      // Someone watching the greeting (the projector now starts well before the cake) leaves it for the cake.
      const watching = wk.act?.kind === 'watch' && !wk.act.sky;
      if (!(this.idle(wk) || watching) || this.rng() >= this.cfg.party.cakeBias) continue;
      if (watching) this.endAct(wk);
      this.sendToCake(wk);
    }
  }

  private sendToCake(wk: Walker): boolean {
    const places = this.world.tables.flatMap((t) => t.seats).filter((st) => !this.seatTaken.has(st.id));
    if (!places.length) return false;
    // The nearest free place, so people do not cross the yard past an empty one.
    const place = places.reduce((best, st) => (Math.hypot(st.approach[0] - wk.x, st.approach[1] - wk.y) < Math.hypot(best.approach[0] - wk.x, best.approach[1] - wk.y) ? st : best));
    const route = findRoute(this.world, [wk.x, wk.y], place.approach);
    if (!route) return false;
    wk.act = { kind: 'cake', seat: place.id, phase: 'to' };
    wk.route = route.slice(1);
    wk.pauseLeft = 0;
    this.seatTaken.set(place.id, this.walkers.indexOf(wk));
    if (route.length <= 1) this.arrive(wk);
    return true;
  }

  /** Tell the sim the day's birthday, or null. Call before `setClock`. */
  setBirthday(day: BirthdayDay | null) {
    const same = JSON.stringify(day) === JSON.stringify(this.birthday);
    this.birthday = day;
    if (!same) this.applyBirthday(true);
  }

  /** Work out whether the party, the cake and the movie are on at this moment and react to a change. */
  private applyBirthday(force = false) {
    const night = this.night;
    const party = !night && partyOn(this.birthday, this.minutes);
    const cake = !night && cakeOn(this.birthday, this.minutes) && this.world.tables.length > 0;
    this.presentsOut = !night && !!this.birthday && this.minutes >= this.birthday.partyStart;
    this.balloonsOut = !night && !!this.birthday && this.minutes >= this.cfg.party.balloonsFromMin;
    if (party !== this.party || force) {
      this.party = party;
      // Everyone free picks a fresh destination: the party yard.
      if (party) for (const wk of this.walkers) if (this.idle(wk)) wk.route = [];
    }
    if (cake !== this.cake) {
      this.cake = cake;
      if (cake) this.gatherCake();
      else for (const wk of this.walkers) if (wk.act?.kind === 'cake') this.endAct(wk);
    }
  }

  /** True between the configured night hours (11 pm to 6 am): everyone is indoors. */
  night = false;

  /** It is the Fourth of July (set by the caller before `setClock`), and the display is on from 8 pm to 11 pm. */
  fireworksDay = false;
  fireworksOn = false;
  private get fireworksCfg() {
    return this.cfg.fireworks;
  }

  setFireworksDay(day: boolean) {
    if (day === this.fireworksDay) return;
    this.fireworksDay = day;
    this.setClock(this.minutes);
  }

  private setFireworksOn(on: boolean) {
    this.fireworksOn = on;
    if (on) {
      // Everyone outside who is free goes to watch; whoever is indoors comes out, spread over a few seconds.
      for (const wk of this.walkers) {
        if (wk.visit?.phase === 'inside' && !wk.visit.night) wk.visit.left = this.rng() * this.cfg.night.riseSpreadS * 0.5;
        else if (this.idle(wk) && this.rng() < this.fireworksCfg.attendBias) this.assignSky(wk);
      }
    } else {
      for (const wk of this.walkers) if (wk.act?.kind === 'watch' && wk.act.sky) this.endAct(wk);
    }
  }

  /** Send someone to a free place on the open ground at the back of the lot. */
  private assignSky(wk: Walker): boolean {
    const spots = this.world.skySpots;
    if (!spots.length) return false;
    const taken = this.walkers.flatMap((o) => (o.act?.kind === 'watch' && o.act.sky ? [o.act.spot] : []));
    for (let tries = 0; tries < 14; tries++) {
      const spot = spots[Math.floor(this.rng() * spots.length)];
      if (taken.some((t) => Math.hypot(t[0] - spot[0], t[1] - spot[1]) < 0.5)) continue;
      const route = findRoute(this.world, [wk.x, wk.y], spot);
      if (!route) continue;
      wk.act = { kind: 'watch', phase: 'to', spot, sky: true };
      wk.route = route.slice(1);
      wk.pauseLeft = 0;
      if (route.length <= 1) this.arrive(wk);
      return true;
    }
    return false;
  }

  /**
   * Called with the minute of the day. The movie starts and ends with it, and people are drawn to it; at night people
   * and dogs go in and out of sight, walking to a door when time passes normally and all at once when the clock jumps.
   */
  setClock(minutes: number) {
    const prev = this.minutes;
    this.minutes = minutes;
    const nc = this.cfg.night;
    const night = minutes >= nc.startMin || minutes < nc.endMin;
    const jumped = Math.abs(minutes - prev) > nc.jumpMin;
    const mc = this.cfg.movie;
    const movieStart = this.birthday ? Math.min(this.birthday.movieStart, mc.endMin) : mc.startMin;
    const fw = !night && this.fireworksDay && this.world.skySpots.length > 0 && minutes >= this.fireworksCfg.startMin && minutes < this.fireworksCfg.endMin;
    if (fw !== this.fireworksOn) this.setFireworksOn(fw);
    // No film on the night of the fireworks.
    const on = !night && !fw && !!this.world.screen && minutes >= movieStart && minutes < mc.endMin;
    if (on !== this.movieOn) {
      this.movieOn = on;
      this.syncBeam();
      if (on) {
        for (const wk of this.walkers) if (this.idle(wk) && this.rng() < mc.attendBias) this.assignWatch(wk);
      } else {
        for (const wk of this.walkers) if (wk.act?.kind === 'watch') this.endAct(wk);
      }
    }
    if (night !== this.night) {
      this.night = night;
      if (night) this.sendIn(jumped);
      else this.bringOut();
    }
    this.applyBirthday();
  }

  /** Night falls: everyone heads for the nearest door, or is simply gone from the yard when the clock jumped. */
  private sendIn(now: boolean) {
    for (const wk of this.walkers) {
      if (wk.act) this.endAct(wk);
      wk.talking = false;
      wk.route = [];
      if (wk.visit?.phase === 'inside') {
        wk.visit.night = true;
        wk.visit.left = Infinity;
        continue;
      }
      const doors = this.world.doors;
      if (!doors.length) {
        wk.away = true;
        wk.speed = 0;
        continue;
      }
      const door = doors.reduce((best, d) => (Math.hypot(d.approach[0] - wk.x, d.approach[1] - wk.y) < Math.hypot(best.approach[0] - wk.x, best.approach[1] - wk.y) ? d : best));
      const route = now ? null : findRoute(this.world, [wk.x, wk.y], door.approach);
      if (route && route.length > 1) {
        wk.visit = { door: door.id, phase: 'to', left: 0, night: true };
        wk.route = route.slice(1);
        wk.pauseLeft = 0;
      } else {
        wk.visit = { door: door.id, phase: 'inside', left: Infinity, night: true };
        wk.x = door.stand[0];
        wk.y = door.stand[1];
        wk.speed = 0;
      }
    }
  }

  /** Morning: they come out of their doors one by one and go about the day. */
  private bringOut() {
    const spread = this.cfg.night.riseSpreadS;
    for (const wk of this.walkers) {
      wk.away = false;
      if (!wk.visit?.night) continue;
      wk.visit.night = false;
      if (wk.visit.phase === 'inside') wk.visit.left = this.rng() * spread;
      else if (wk.visit.phase === 'to') wk.visit.left = 0; // still walking in: it will come straight back out
    }
  }

  /** Send someone to a free spot in front of the screen. */
  private assignWatch(wk: Walker): boolean {
    const sc = this.world.screen;
    if (!sc) return false;
    const gap = this.cfg.movie.spotGapFt;
    const taken = this.walkers.flatMap((o) => (o.act?.kind === 'watch' ? [o.act.spot] : []));
    for (let tries = 0; tries < 14; tries++) {
      const spot = sc.spots[Math.floor(this.rng() * sc.spots.length)];
      if (taken.some((t) => Math.hypot(t[0] - spot[0], t[1] - spot[1]) < gap)) continue;
      const route = findRoute(this.world, [wk.x, wk.y], spot);
      if (!route) continue;
      wk.act = { kind: 'watch', phase: 'to', spot };
      wk.route = route.slice(1);
      wk.pauseLeft = 0;
      if (route.length <= 1) this.arrive(wk);
      return true;
    }
    return false;
  }

  /** Call a few people to sit down together at a table, in neighboring seats so they can talk. */
  private startDinner(host: Walker): boolean {
    const tables = this.world.tables;
    if (!tables.length) return false;
    const c = this.cfg.dining;
    const table = tables[Math.floor(this.rng() * tables.length)];
    const free = table.seats.filter((st) => !this.seatTaken.has(st.id));
    const want = Math.min(free.length, c.groupSize[0] + Math.floor(this.rng() * (c.groupSize[1] - c.groupSize[0] + 1)));
    if (want < 2) return false;
    // A run of neighboring seats around the table (the seats are numbered in a ring).
    const byIndex = new Map(free.map((st) => [st.index, st]));
    const ringLen = 8;
    const starts = Array.from({ length: ringLen }, (_, i) => i).sort(() => this.rng() - 0.5);
    let run: WorldSeat[] | null = null;
    for (const start of starts) {
      const seats: WorldSeat[] = [];
      for (let k = 0; k < want; k++) {
        const st = byIndex.get((start + k) % ringLen);
        if (!st) break;
        seats.push(st);
      }
      if (seats.length === want) { run = seats; break; }
    }
    if (!run) return false;
    const others = this.walkers.filter((o) => o !== host && this.idle(o)).sort(() => this.rng() - 0.5).slice(0, want - 1);
    const group = [host, ...others];
    let seated = 0;
    group.forEach((wk, k) => {
      const seat = run![k];
      const route = findRoute(this.world, [wk.x, wk.y], seat.approach);
      if (!route) return;
      wk.act = { kind: 'dine', seat: seat.id, phase: 'to', t: 0, left: 0 };
      wk.route = route.slice(1);
      wk.pauseLeft = 0;
      this.seatTaken.set(seat.id, this.walkers.indexOf(wk));
      seated++;
      if (route.length <= 1) this.arrive(wk);
    });
    return seated > 0 && host.act !== null;
  }

  /** Advance everyone by `dt` seconds, in steps no longer than the configured maximum. */
  step(dt: number) {
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(left, this.cfg.maxStepS);
      this.stepOnce(h);
      left -= h;
    }
  }

  private stepOnce(dt: number) {
    const w = this.world;
    for (const wk of this.walkers) {
      const turn = (wk.kind === 'person' ? this.cfg.people.turnRate : this.cfg.dogs.turnRate) * dt;
      if (wk.away) continue;
      if (wk.meetCool > 0) wk.meetCool -= dt;
      if (wk.leader !== null) wk.replan -= dt;
      if (wk.kind === 'person') {
        this.relax(wk, dt);
        this.stepSmile(wk, dt);
        if ((!wk.act || wk.act.phase === 'to') && !wk.visit) this.stepGaze(wk, dt);
      }
      if (wk.act && wk.act.phase !== 'to') {
        if (wk.act.kind === 'linger') this.stepLinger(wk, dt);
        else if (wk.act.kind === 'chase') this.stepChase(wk, dt);
        else if (wk.act.kind === 'dine') this.stepDine(wk, dt);
        else if (wk.act.kind === 'harvest') this.stepHarvest(wk, dt);
        else if (wk.act.kind === 'meet') this.stepMeet(wk, dt);
        else if (wk.act.kind === 'cake') this.stepCake(wk);
        else this.stepWatch(wk, dt);
        continue;
      }
      if (wk.visit && wk.visit.phase !== 'to') {
        this.stepVisit(wk, dt);
        continue;
      }
      if (wk.pauseLeft > 0) {
        wk.pauseLeft -= dt;
        wk.speed = 0;
        wk.probeT = 0;
        continue;
      }
      if (wk.route.length === 0 || (wk.leader !== null && wk.replan <= 0)) {
        if (wk.leader !== null) wk.replan = wk.kind === 'dog' ? this.cfg.dogs.replanS : this.cfg.people.toddlerReplanS;
        const hadRoute = wk.route.length > 0;
        this.plan(wk);
        if (wk.route.length === 0 && !hadRoute) {
          wk.pauseLeft = wk.kind === 'person' ? this.between(this.cfg.people.pauseS) : this.between(this.cfg.dogs.pauseS);
          wk.speed = 0;
          continue;
        }
      }
      const next = wk.route[0];
      if (!next) continue;
      const dx = next[0] - wk.x, dy = next[1] - wk.y;
      const dist = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      let diff = want - wk.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      wk.heading += Math.max(-turn, Math.min(turn, diff));
      const M = this.cfg.people.manner;
      const person = wk.kind === 'person';
      const pace = person ? paceMultiplier(wk.pers, M, this.minutes, this.clock) * (wk.skip > 0 ? M.play.skipSpeedMul : 1) : 1;
      const speed = wk.cruise * pace * (Math.abs(diff) > 1.2 ? 0.4 : 1);
      const move = Math.min(dist, speed * dt);
      let nx = wk.x + (dx / (dist || 1)) * move, ny = wk.y + (dy / (dist || 1)) * move;
      // Nobody walks a ruler-straight line: a gentle weave to either side of the route, fading out as they near the end.
      if (person && wk.leader === null && dist > 0.05) {
        let remaining = dist;
        for (let r = 1; r < wk.route.length; r++) remaining += Math.hypot(wk.route[r][0] - wk.route[r - 1][0], wk.route[r][1] - wk.route[r - 1][1]);
        const fade = Math.max(0, Math.min(1, (remaining - M.weave.minLeftFt) / M.weave.minLeftFt));
        const wantOff = weaveOffset(wk.weaveD + move, wk.pers.weaveAmp, wk.pers.weaveLen, wk.pers.phase) * fade;
        const delta = wantOff - wk.weaveOff;
        const lx = nx - (dy / (dist || 1)) * delta, ly = ny + (dx / (dist || 1)) * delta;
        if (!w.blocked[idx(w, ...cellOf(w, lx, ly))]) {
          nx = lx;
          ny = ly;
          wk.weaveOff = wantOff;
        }
        wk.weaveD += move;
      }
      // People keep clear of each other: step around someone in the way, or wait if there is no room.
      if (wk.kind === 'person') {
        const adj = this.avoid(wk, nx, ny);
        if (!adj) {
          wk.speed = 0;
          this.heldUp(wk, dt);
          continue;
        }
        [nx, ny] = adj;
        wk.blockedS = 0;
      }
      const [ci, cj] = cellOf(w, nx, ny);
      if (!w.blocked[idx(w, ci, cj)]) {
        wk.x = nx;
        wk.y = ny;
      } else {
        wk.route = [];
        continue;
      }
      wk.speed = move / dt;
      wk.gait += move * (wk.kind === 'person' ? Math.PI / wk.stepFt : 2.4);
      if (wk.kind === 'person') this.checkHeadway(wk, dt);
      if (dist - move < 0.25) wk.route.shift();
      if (wk.route.length === 0) {
        if (wk.act?.phase === 'to') {
          this.arrive(wk);
          continue;
        }
        if (wk.visit?.phase === 'to') {
          this.startEntering(wk);
          continue;
        }
        wk.pauseLeft = wk.kind === 'person' ? this.between(this.cfg.people.pauseS) : this.between(this.cfg.dogs.pauseS);
        wk.speed = 0;
      }
    }
    this.separate(dt);
    this.stepGround(dt);
    this.stepDoors(dt);
    this.stepProjector(dt);
    this.clock += dt;
    this.stepFlights(dt);
    this.stepTables(dt);
    this.stepBees(dt);
  }

  private stepBees(dt: number) {
    const w = this.world, hive = w.hive, c = this.cfg.bees;
    if (!hive) return;
    for (const b of this.bees) {
      b.timer -= dt;
      b.wobble += dt * 9;
      if (b.phase === 'rest') {
        b.x = hive.x;
        b.y = hive.y;
        b.z = 1.5;
        if (b.timer <= 0) {
          const blooms = w.blooms.filter((f) => Math.hypot(f.x - hive.x, f.y - hive.y) <= c.rangeFt);
          if (blooms.length) {
            const f = blooms[Math.floor(this.rng() * blooms.length)];
            b.target = { x: f.x, y: f.y, z: f.height + 0.3, radius: f.radius };
          } else {
            let a = this.rng() * Math.PI * 2, d = 3 + this.rng() * c.wanderFt;
            for (let k = 0; k < 8 && w.structureTops.some((st) => pointInPolygon(hive.x + Math.cos(a) * d, hive.y + Math.sin(a) * d, st.poly)); k++) {
              a = this.rng() * Math.PI * 2;
              d = 3 + this.rng() * c.wanderFt;
            }
            b.target = { x: hive.x + Math.cos(a) * d, y: hive.y + Math.sin(a) * d, z: c.altitudeFt[0] + this.rng() * (c.altitudeFt[1] - c.altitudeFt[0]), radius: 1 };
          }
          b.phase = 'out';
          b.speed = this.between(c.speedFt);
        }
        continue;
      }
      if (b.phase === 'out' || b.phase === 'back') {
        const goal = b.phase === 'out' ? b.target! : { x: hive.x, y: hive.y, z: 1.5, radius: 0 };
        const dx = goal.x - b.x, dy = goal.y - b.y, dz = goal.z - b.z;
        const dist = Math.hypot(dx, dy, dz);
        const step = Math.min(dist, b.speed * dt);
        // Fly mostly straight, with a small weaving sideways.
        const sx = -dy / (Math.hypot(dx, dy) || 1), sy = dx / (Math.hypot(dx, dy) || 1);
        const sway = Math.sin(b.wobble) * c.wobbleFt * dt * 3 * Math.min(1, dist / 3);
        b.heading = Math.atan2(dy, dx);
        b.x += (dx / (dist || 1)) * step + sx * sway;
        b.y += (dy / (dist || 1)) * step + sy * sway;
        b.z += (dz / (dist || 1)) * step;
        keepOutOfStructures(w, b, dt); // over the roof, never through it
        if (dist < 0.4) {
          if (b.phase === 'out') {
            b.phase = 'forage';
            b.timer = this.between(c.forageS);
            b.angle = this.rng() * Math.PI * 2;
          } else {
            b.phase = 'rest';
            b.timer = this.between(c.restS);
          }
        }
        continue;
      }
      // Feeding: circle the flowering top of the plant.
      const t = b.target!;
      b.angle += dt * 2.2;
      b.heading = b.angle + Math.PI / 2;
      const r = Math.max(0.3, t.radius * 0.6);
      b.x = t.x + Math.cos(b.angle) * r;
      b.y = t.y + Math.sin(b.angle) * r;
      b.z = t.z + Math.sin(b.wobble) * 0.15;
      if (b.timer <= 0) {
        b.phase = 'back';
        b.speed = this.between(c.speedFt);
      }
    }
  }
}

export interface HiveCheck {
  lot: { width: number; depth: number };
  structures: Pt[][];
  plants: { x: number; y: number; r: number }[];
  /** Outlines of the paths, where people walk. */
  paths: Pt[][];
}

/**
 * What is wrong with a spot for the hive, in plain words (empty when it is a good one): outside the lot, too near a
 * building, a plant or a path, where bees on their way out meet people.
 */
export function hiveProblems(h: { x: number; y: number }, c: HiveCheck, cfg: Cfg): string[] {
  const hc = cfg.bees.hive;
  const out: string[] = [];
  if (h.x < cfg.margins.lotFt || h.y < cfg.margins.lotFt || h.x > c.lot.width - cfg.margins.lotFt || h.y > c.lot.depth - cfg.margins.lotFt) out.push('Too close to the lot edge.');
  if (c.structures.some((s) => pointInPolygon(h.x, h.y, s))) out.push('Inside a building.');
  else if (c.structures.some((s) => distanceToPolygon(h.x, h.y, s) < hc.minFromStructureFt)) out.push(`Within ${hc.minFromStructureFt} ft of a building.`);
  if (c.plants.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < p.r + hc.minFromPlantFt)) out.push('In or right beside a plant.');
  if (c.paths.some((p) => pointInPolygon(h.x, h.y, p) || distanceToPolygon(h.x, h.y, p) < hc.minFromPathFt)) out.push(`Within ${hc.minFromPathFt} ft of a path, where people walk.`);
  return out;
}

/**
 * Keep something that flies out of the buildings: it never goes through a roof or wall, but climbs and passes over. It
 * starts rising a few feet before it reaches a building and settles again beyond it (its own flight brings it back down).
 */
export function keepOutOfStructures(w: Pick<LifeWorld, 'structureTops'>, o: { x: number; y: number; z: number; heading: number }, dt: number, climbFtPerS = 14): void {
  for (const s of w.structureTops) {
    const inside = pointInPolygon(o.x, o.y, s.poly);
    const entering = !inside && pointInPolygon(o.x + Math.cos(o.heading) * 4, o.y + Math.sin(o.heading) * 4, s.poly);
    if (!inside && !entering) continue;
    const clear = s.top + 1;
    if (o.z < clear) o.z = Math.min(clear, o.z + climbFtPerS * dt);
    if (inside && o.z < s.top + 0.2) o.z = s.top + 0.2;
  }
}
