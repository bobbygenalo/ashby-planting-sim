import { distanceToPolygon, pointInPolygon } from './geometry';
import { footprint } from './hardscape';
import { worldSeats, type WorldSeat } from './furniture';
import { isBlooming, type PlacedPlant } from './growth';
import { mulberry32 } from './shuffle';
import type { EngineConfig, HardscapeElement, Material, Pt, SiteConfig, StructureCfg } from './types';

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
}

/** A door: where someone stands to go in, and the open ground a little way out where they walk to first. */
export interface LifeDoor {
  id: string;
  label: string;
  building: string;
  /** Just outside the wall, where they step in and out of sight. */
  stand: Pt;
  approach: Pt;
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
    plants: [], structures: input.structures.map((s) => s.footprint), blooms: [], hive: null, doors: [], tables: [], screen: null,
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
      if (!blocked[k] && w.plants.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + cfg.margins.plantFt)) blocked[k] = 1;
    }
  }
  w.blooms = input.plants
    .filter((p) => p.size.planted && isBlooming(p.species, input.month) && p.species.pollinator.groups.some((g) => g === 'honey bees' || g === 'native bees'))
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
  w.tables = buildTables(w, input, cfg);
  w.screen = buildScreen(w, input, cfg);
  return w;
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
    if (best) out.push({ id: d.id, label: d.label, building: d.building, stand: [d.point[0] + d.outward[0] * 0.25, d.point[1] + d.outward[1] * 0.25], approach: best });
  }
  return out;
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
  for (const k of w.reachable) {
    const [cx, cy] = center(w, k % w.nx, Math.floor(k / w.nx));
    if (cx - best.x >= mc.spotFromWallFt[0] && cx - best.x <= mc.spotFromWallFt[1] && Math.abs(cy - y) <= mc.spotLateralFt) spots.push([cx, cy]);
  }
  if (spots.length < 3) return null;
  return { x: best.x, y, width, bottom: mc.bottomFt, height: mc.heightFt, spots, projector: [best.x + mc.projectorFromWallFt, y] };
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
        const step = Math.hypot(di, dj) * w.cell * (w.cost[k] + w.cost[n]) * 0.5;
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
  | { kind: 'watch'; phase: 'to' | 'watch'; spot: Pt };

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
  visit: { door: string; phase: 'to' | 'in' | 'inside' | 'out'; left: number; /** Gone in for the night: stays until morning. */ night?: boolean } | null;
  /** Out of sight for the night in a plan with no door to go in by. */
  away: boolean;
  /** Sitting down to talk at a table, or standing to watch the movie. */
  act: Act | null;
  /** How far down into a chair they are, 0 standing to 1 seated. */
  sit: number;
  /** True while this person is the one speaking at their table. */
  talking: boolean;
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
}

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
  /** Seat id -> the walker sitting or heading there. */
  private seatTaken = new Map<string, number>();
  private tableTalk = new Map<string, { speaker: number; left: number }>();
  /** Minute of the day, set by the caller; the movie shows between the configured start and end. */
  minutes = 720;
  movieOn = false;
  private clock = 0;
  private rng: () => number;
  private cfg: Cfg;
  private counts: LifeCounts;

  constructor(world: LifeWorld, cfg: Cfg, seed: number, counts: LifeCounts) {
    this.world = world;
    this.cfg = cfg;
    this.rng = mulberry32(seed);
    this.counts = { people: Math.max(0, Math.min(cfg.people.max, Math.floor(counts.people))), dogs: Math.max(0, Math.min(cfg.dogs.max, Math.floor(counts.dogs))), bees: counts.bees };
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
        pauseLeft: this.rng() * 2, leader, visit: null, act: null, sit: 0, talking: false, headTurn: 0, away: false, age: spec?.age ?? 0, heightFt: spec?.heightFt ?? this.cfg.dogs.heightFt, variant: Math.floor(this.rng() * 1000),
        replan: 0, cruise: this.between(spec ? spec.speedFt : this.cfg.dogs.speedFt),
      });
    }
    this.bees = [];
    const hive = this.world.hive;
    if (this.counts.bees && hive) {
      for (let n = 0; n < this.cfg.bees.count; n++) {
        this.bees.push({ x: hive.x, y: hive.y, z: 1.5, phase: 'rest', timer: this.rng() * this.cfg.bees.restS[1] * 2, target: null, angle: this.rng() * 6.28, wobble: this.rng() * 6.28, speed: this.between(this.cfg.bees.speedFt), heading: 0 });
      }
    }
  }

  /** The yard changed (a plant grew, something was drawn): re-plan, and move anyone now standing on blocked ground. */
  setWorld(world: LifeWorld) {
    this.world = world;
    for (const wk of this.walkers) {
      wk.route = [];
      // A seat, or the screen, that is gone ends what they were doing there; the rest carry on.
      if (wk.act) {
        const ok = wk.act.kind === 'dine' ? !!this.findSeat(wk.act.seat) : !!world.screen;
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
    if (!world.hive) this.bees = [];
    else if (this.counts.bees && this.bees.length === 0) this.populate();
  }

  setCounts(counts: LifeCounts) {
    this.counts = { people: Math.max(0, Math.min(this.cfg.people.max, Math.floor(counts.people))), dogs: Math.max(0, Math.min(this.cfg.dogs.max, Math.floor(counts.dogs))), bees: counts.bees };
    this.populate();
  }

  private nearestFree(x: number, y: number): Pt | null {
    const w = this.world;
    const [ci, cj] = cellOf(w, x, y);
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let r = 0; r < Math.max(w.nx, w.ny) && !best; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= w.nx || j >= w.ny || w.blocked[idx(w, i, j)]) continue;
          const [px, py] = center(w, i, j);
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
      if (w.pathCells.length && this.rng() < this.cfg.people.pathBias) {
        const k = w.pathCells[Math.floor(this.rng() * w.pathCells.length)];
        p = center(w, k % w.nx, Math.floor(k / w.nx));
      } else p = this.randomCell();
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
    if (!doors.length || wk.leader !== null || wk.kind !== 'person' || this.rng() >= this.cfg.people.visitBias) return null;
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
      if (this.movieOn && this.rng() < this.cfg.movie.joinBias && this.assignWatch(wk)) return;
      if (this.world.tables.length && this.rng() < this.cfg.dining.bias && this.startDinner(wk)) return;
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
      if (v.left <= 0) v.phase = 'out';
      return;
    }
    const goal = v.phase === 'in' ? door.stand : door.approach;
    const dx = goal[0] - wk.x, dy = goal[1] - wk.y;
    const dist = Math.hypot(dx, dy);
    const speed = wk.cruise * 0.7;
    const move = Math.min(dist, speed * dt);
    if (dist > 1e-6) {
      wk.heading = Math.atan2(dy, dx);
      wk.x += (dx / dist) * move;
      wk.y += (dy / dist) * move;
    }
    wk.speed = dt > 0 ? move / dt : 0;
    wk.gait += move * 1.6 * (5.6 / wk.heightFt) ** 0.8;
    if (dist - move < 0.05) {
      if (v.phase === 'in') {
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
    wk.act = null;
    wk.sit = 0;
    wk.talking = false;
    wk.headTurn = 0;
    wk.route = [];
    wk.speed = 0;
    wk.pauseLeft = this.between(this.cfg.people.pauseS) * 0.5;
    const [i, j] = cellOf(this.world, wk.x, wk.y);
    if (this.world.blocked[idx(this.world, i, j)]) {
      const p = this.nearestFree(wk.x, wk.y);
      if (p) [wk.x, wk.y] = p;
    }
  }

  /** Where someone with an act is heading while they walk there. */
  private actTarget(wk: Walker): Pt | null {
    const a = wk.act;
    if (!a) return null;
    if (a.kind === 'watch') return a.spot;
    return this.findSeat(a.seat)?.approach ?? null;
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

  /** True between the configured night hours (11 pm to 6 am): everyone is indoors. */
  night = false;

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
    const on = !night && !!this.world.screen && minutes >= mc.startMin && minutes < mc.endMin;
    if (on !== this.movieOn) {
      this.movieOn = on;
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
      if (wk.leader !== null) wk.replan -= dt;
      if (wk.act && wk.act.phase !== 'to') {
        if (wk.act.kind === 'dine') this.stepDine(wk, dt);
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
      const speed = wk.cruise * (Math.abs(diff) > 1.2 ? 0.4 : 1);
      const move = Math.min(dist, speed * dt);
      const nx = wk.x + (dx / (dist || 1)) * move, ny = wk.y + (dy / (dist || 1)) * move;
      const [ci, cj] = cellOf(w, nx, ny);
      if (!w.blocked[idx(w, ci, cj)]) {
        wk.x = nx;
        wk.y = ny;
      } else {
        wk.route = [];
        continue;
      }
      wk.speed = move / dt;
      wk.gait += move * (wk.kind === 'person' ? 1.6 * (5.6 / wk.heightFt) ** 0.8 : 2.4);
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
    this.clock += dt;
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
            const a = this.rng() * Math.PI * 2, d = 3 + this.rng() * c.wanderFt;
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
