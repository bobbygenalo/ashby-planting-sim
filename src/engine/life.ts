import { distanceToPolygon, pointInPolygon } from './geometry';
import { footprint } from './hardscape';
import { isBlooming, type PlacedPlant } from './growth';
import { mulberry32 } from './shuffle';
import type { EngineConfig, HardscapeElement, Material, Pt, SiteConfig, StructureCfg } from './types';

type Cfg = EngineConfig['life'];

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
    plants: [], structures: input.structures.map((s) => s.footprint), blooms: [], hive: null,
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
        if (el.type === 'raisedBed' || el.type === 'wall' || el.type === 'fence') blocked[k] = 1;
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
  const hive = input.hive && hiveSpotIsGood(w, input.hive, cfg) ? input.hive : chooseHiveSpot(w, cfg, mulberry32(7));
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
  return w;
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
  /** A person a dog follows. */
  leader: number | null;
  /** Looks, chosen once. */
  variant: number;
  replan: number;
  cruise: number;
}

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
      this.walkers.push({
        kind: person ? 'person' : 'dog', x: p[0], y: p[1], heading: this.rng() * Math.PI * 2, speed: 0, gait: this.rng() * 6, route: [],
        pauseLeft: this.rng() * 2, leader: person || this.counts.people === 0 ? null : (n - this.counts.people) % this.counts.people, variant: Math.floor(this.rng() * 1000),
        replan: 0, cruise: this.between(person ? this.cfg.people.speedFt : this.cfg.dogs.speedFt),
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
      const [i, j] = cellOf(world, wk.x, wk.y);
      if (world.blocked[idx(world, i, j)]) {
        const p = this.nearestFree(wk.x, wk.y);
        if (p) [wk.x, wk.y] = p;
      }
    }
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

  private pickDogTarget(wk: Walker): Pt | null {
    const leader = wk.leader !== null ? this.walkers[wk.leader] : null;
    if (!leader) return this.randomCell();
    const a = this.rng() * Math.PI * 2;
    const d = this.between(this.cfg.dogs.followFt);
    const t = this.nearestFree(leader.x + Math.cos(a) * d, leader.y + Math.sin(a) * d);
    return t;
  }

  private plan(wk: Walker) {
    const target = wk.kind === 'person' ? this.pickPersonTarget(wk) : this.pickDogTarget(wk);
    if (!target) return;
    const route = findRoute(this.world, [wk.x, wk.y], target);
    wk.route = route ? route.slice(1) : [];
    if (!route) wk.pauseLeft = 0.5;
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
      if (wk.kind === 'dog') wk.replan -= dt;
      if (wk.pauseLeft > 0) {
        wk.pauseLeft -= dt;
        wk.speed = 0;
        continue;
      }
      if (wk.route.length === 0 || (wk.kind === 'dog' && wk.leader !== null && wk.replan <= 0)) {
        if (wk.kind === 'dog') wk.replan = this.cfg.dogs.replanS;
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
      wk.gait += move * (wk.kind === 'person' ? 1.6 : 2.4);
      if (dist - move < 0.25) wk.route.shift();
      if (wk.route.length === 0) {
        wk.pauseLeft = wk.kind === 'person' ? this.between(this.cfg.people.pauseS) : this.between(this.cfg.dogs.pauseS);
        wk.speed = 0;
      }
    }
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
