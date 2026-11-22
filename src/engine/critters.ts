import { keepOutOfStructures, type LifeWorld, type WormSpot } from './life';
import { pointInPolygon } from './geometry';
import { mulberry32 } from './shuffle';
import type { LifeCfg } from './types';

type Cfg = LifeCfg['critters'];

export interface Hummer {
  x: number;
  y: number;
  z: number;
  heading: number;
  state: 'perch' | 'dart' | 'feed';
  timer: number;
  target: { x: number; y: number; z: number } | null;
  /** 0 not there, 1 fully there: fades in and out as hummingbirds come and go. */
  vis: number;
  wanted: boolean;
  phase: number;
}

export interface Butterfly {
  x: number;
  y: number;
  z: number;
  heading: number;
  state: 'flutter' | 'land';
  timer: number;
  target: { x: number; y: number; z: number } | null;
  vis: number;
  wanted: boolean;
  phase: number;
  flapHz: number;
  speed: number;
  /** Which of a few wing colors. */
  variant: number;
}

export interface Worm {
  x: number;
  y: number;
  heading: number;
  /** How far out of the ground it is: 0 hidden, 1 lying on the surface. */
  ext: number;
  want: number;
  phase: number;
  spot: number;
  /** Chosen once; the worm is up when this is under how likely worms are to be up right now. */
  lot: number;
}

export interface Bird {
  /** The species this slot is playing now (an id from the config), or null when idle. */
  species: string | null;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: 'perch' | 'fly' | 'forage';
  timer: number;
  target: { x: number; y: number; z: number; ground: boolean } | null;
  vis: number;
  wanted: boolean;
  phase: number;
  /** Birds of a flock follow their leader's slot; a lone bird leads itself. */
  leader: number;
  /** Whether it is on its way down to the ground to forage rather than a perch. */
  hopping: boolean;
}

export type Daylight = { minutes: number; night: boolean };

export interface BirdPlan {
  id: string;
  count: number;
}

/**
 * Which native birds are about right now and how many of each: a species must be in its months and the day must be
 * bright, and the yard must offer what it comes for: soil to scratch for ground feeders, perches for the others, ripe
 * fruit or berries for the fruit eaters, flowers for the nectar sipper. The total stays within the most the yard shows.
 */
export function birdPlan(world: Pick<LifeWorld, 'month' | 'wormSpots' | 'perches' | 'birdFood' | 'flowers'>, d: Daylight, c: Cfg['birds'], flockSize: (sp: Cfg['birds']['species'][number]) => number = (sp) => sp.flock[0]): BirdPlan[] {
  if (d.night || d.minutes < c.fromMin || d.minutes >= c.toMin) return [];
  const nectar = world.flowers.some((f) => f.groups.includes('hummingbirds'));
  const offers: Record<BirdSpeciesCfgGuild, boolean> = {
    ground: world.wormSpots.length > 0 && world.perches.length > 0, // open ground with some cover to retreat to
    canopy: world.perches.length > 0,
    fruit: world.birdFood.length > 0,
    nectar,
  };
  // Every species that is here and has what it needs gets its smallest flock, the visitors of the season first; the rest
  // of the room goes to filling out flocks in the same order. So a full yard still shows the season's birds.
  const active = c.species.filter((sp) => sp.months.includes(world.month) && offers[sp.guild]).sort((a, b) => a.months.length - b.months.length);
  const counts = new Map<string, number>();
  let room = c.max;
  for (const sp of active) {
    const base = sp.flock[0];
    if (room < base) continue;
    counts.set(sp.id, base);
    room -= base;
  }
  for (const sp of active) {
    const want = Math.max(sp.flock[0], Math.min(sp.flock[1], flockSize(sp)));
    const more = Math.min(want - (counts.get(sp.id) ?? 0), room);
    if (counts.has(sp.id) && more > 0) {
      counts.set(sp.id, counts.get(sp.id)! + more);
      room -= more;
    }
  }
  const out: BirdPlan[] = c.species.filter((sp) => counts.has(sp.id)).map((sp) => ({ id: sp.id, count: counts.get(sp.id)! }));
  return out;
}

type BirdSpeciesCfgGuild = Cfg['birds']['species'][number]['guild'];

const between = (rng: () => number, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);

/** How likely a worm is to be up on the surface: more in the cool wet months, at night, and in the shade by day. */
export function wormUpChance(month: number, minutes: number, shade: boolean, c: Cfg['worms']): number {
  const season = c.activityByMonth[(month - 1 + 12) % 12] ?? 0;
  const night = c.nightFromMin <= c.nightToMin ? minutes >= c.nightFromMin && minutes < c.nightToMin : minutes >= c.nightFromMin || minutes < c.nightToMin;
  const time = night ? 1 : shade ? c.dayShade : c.daySun;
  return season * time;
}

/** Hummingbirds about this moment: daytime, with flowers in bloom that they visit. */
export function hummerCount(world: Pick<LifeWorld, 'flowers'>, d: Daylight, c: Cfg['hummer']): number {
  if (d.night || d.minutes < c.fromMin || d.minutes >= c.toMin) return 0;
  const n = world.flowers.filter((f) => f.groups.includes('hummingbirds')).length;
  return n === 0 ? 0 : Math.min(c.max, Math.ceil(n / c.bloomsPerBird));
}

/** Flowers a butterfly would visit: in the sun, not in the shade. */
export function butterflyFlowers(world: Pick<LifeWorld, 'flowers'>, c: Cfg['butterfly']) {
  return world.flowers.filter((f) => f.groups.includes('butterflies') && (f.sun === null || f.sun >= c.minSunHours));
}

/** Butterflies about this moment: in their months and the warm part of the day, with sunny flowers to visit. */
export function butterflyCount(world: Pick<LifeWorld, 'flowers' | 'month'>, d: Daylight, c: Cfg['butterfly']): number {
  if (d.night || !c.months.includes(world.month) || d.minutes < c.fromMin || d.minutes >= c.toMin) return 0;
  const n = butterflyFlowers(world, c).length;
  return n === 0 ? 0 : Math.min(c.max, Math.ceil(n * c.perFlower));
}

/** How many worms there are at all this month, given how active they are. */
export function wormCount(month: number, spots: number, c: Cfg['worms']): number {
  return spots === 0 ? 0 : Math.round(c.max * (c.activityByMonth[(month - 1 + 12) % 12] ?? 0));
}

/**
 * Hummingbirds, butterflies and worms, each where and when it belongs: hummingbirds at flowers they visit while they
 * bloom, in the daytime; butterflies at sunny flowers in warm months in the warm part of the day; worms in the soil,
 * most in the cool wet months, at night, in the shade, and under fallen leaves and compost. Deterministic for a seed.
 */
export class CritterSim {
  hummers: Hummer[] = [];
  butterflies: Butterfly[] = [];
  worms: Worm[] = [];
  birds: Bird[] = [];
  private rng: () => number;
  private t = 0;
  private daylight: Daylight = { minutes: 720, night: false };

  constructor(private world: LifeWorld, private cfg: Cfg, seed: number) {
    this.rng = mulberry32(seed);
    this.makeFliers();
    this.makeWorms();
    this.makeBirds();
  }

  private makeFliers() {
    const c = this.cfg;
    const edge = () => this.edgePoint();
    this.hummers = Array.from({ length: c.hummer.max }, (_, i) => {
      const [x, y] = edge();
      return { x, y, z: 4, heading: 0, state: 'perch' as const, timer: this.rng() * 3, target: null, vis: 0, wanted: false, phase: i * 1.7 };
    });
    this.butterflies = Array.from({ length: c.butterfly.max }, (_, i) => {
      const [x, y] = edge();
      return { x, y, z: 3, heading: this.rng() * 6.28, state: 'flutter' as const, timer: 0, target: null, vis: 0, wanted: false, phase: i * 2.3, flapHz: between(this.rng, c.butterfly.flapHz), speed: between(this.rng, c.butterfly.speedFt), variant: i % 4 };
    });
  }

  private flocks = new Map<string, number>();
  /** How many of a species come together, chosen once so it does not change as the clock moves. */
  private flockSize(id: string, flock: [number, number]): number {
    let n = this.flocks.get(id);
    if (n === undefined) {
      n = flock[0] + Math.floor(this.rng() * (flock[1] - flock[0] + 1));
      this.flocks.set(id, n);
    }
    return n;
  }

  private makeBirds() {
    this.birds = Array.from({ length: this.cfg.birds.max }, (_, i) => {
      const [x, y] = this.edgePoint();
      return { species: null, x, y, z: 4, heading: 0, state: 'perch' as const, timer: this.rng() * 3, target: null, vis: 0, wanted: false, phase: i * 1.37, leader: i, hopping: false };
    });
  }

  /** Give each bird slot a species to play (or none), the birds of a flock following the first of them. */
  private assignBirds() {
    const plan = birdPlan(this.world, this.daylight, this.cfg.birds, (sp) => this.flockSize(sp.id, sp.flock));
    const want = new Map<string, number>(plan.map((p) => [p.id, p.count]));
    // Slots already playing a species still wanted keep it, so nothing swaps in mid-flight.
    const taken = new Map<string, number[]>();
    this.birds.forEach((b, i) => {
      if (b.species && (taken.get(b.species)?.length ?? 0) < (want.get(b.species) ?? 0)) taken.set(b.species, [...(taken.get(b.species) ?? []), i]);
    });
    const used = new Set([...taken.values()].flat());
    const free = this.birds.map((_, i) => i).filter((i) => !used.has(i));
    for (const p of plan) {
      const mine = taken.get(p.id) ?? [];
      while (mine.length < p.count && free.length) {
        const i = free.shift()!;
        const b = this.birds[i];
        if (b.vis > 0.02 && b.species !== p.id) { free.push(i); break; } // still fading out as something else: not yet
        b.species = p.id;
        b.state = 'perch';
        b.target = null;
        b.timer = this.rng() * 2;
        const [x, y] = this.edgePoint();
        b.x = x; b.y = y; b.z = 5;
        mine.push(i);
      }
      taken.set(p.id, mine);
    }
    const keep = new Set([...taken.values()].flat());
    this.birds.forEach((b, i) => {
      b.wanted = keep.has(i);
    });
    for (const ids of taken.values()) ids.forEach((i) => (this.birds[i].leader = ids[0]));
  }

  private insideStructure(x: number, y: number): boolean {
    return this.world.structureTops.some((st) => pointInPolygon(x, y, st.poly));
  }

  /**
   * Where to go on a plant: usually the flowering or fruiting top, but now and then in among the leaves, so the creature
   * seems to slip into the plant (and is half hidden by it).
   */
  private onPlant(f: { x: number; y: number; radius: number; height: number }, topZ: number): { x: number; y: number; z: number } {
    if (this.rng() < 0.4) {
      const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * f.radius * 0.35;
      return { x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, z: Math.max(0.3, f.height * (0.45 + this.rng() * 0.25)) };
    }
    return { x: f.x + (this.rng() - 0.5) * f.radius, y: f.y + (this.rng() - 0.5) * f.radius, z: topZ };
  }

  /** A random point over the lot that is not on a building, for wandering. */
  private openPoint(): [number, number] {
    for (let i = 0; i < 20; i++) {
      const x = this.rng() * this.world.lot.width, y = this.rng() * this.world.lot.depth;
      if (!this.insideStructure(x, y)) return [x, y];
    }
    return [2, 2];
  }

  private edgePoint(): [number, number] {
    const { width, depth } = this.world.lot;
    return this.rng() < 0.5 ? [this.rng() < 0.5 ? 2 : width - 2, this.rng() * depth] : [this.rng() * width, this.rng() < 0.5 ? 2 : depth - 2];
  }

  /** Choose which spots have worms: weighted toward leaf litter, compost, rich soil and shade, and away from baking sun. */
  private makeWorms() {
    const c = this.cfg.worms;
    const spots = this.world.wormSpots;
    const n = wormCount(this.world.month, spots.length, c);
    const weight = (s: WormSpot) =>
      (s.litter === 'compost' ? c.compostWeight : s.litter === 'fresh' ? c.litterWeight : 1) * (s.rich ? c.richWeight : 1) * (s.shade ? c.shadeWeight : c.sunWeight);
    const pool = spots.map((s, i) => ({ i, w: weight(s) }));
    const chosen: number[] = [];
    for (let k = 0; k < n && pool.length; k++) {
      const total = pool.reduce((a, p) => a + p.w, 0);
      let r = this.rng() * total;
      let at = pool.length - 1;
      for (let j = 0; j < pool.length; j++) {
        r -= pool[j].w;
        if (r <= 0) { at = j; break; }
      }
      chosen.push(pool[at].i);
      pool.splice(at, 1);
    }
    this.worms = chosen.map((i) => {
      const s = spots[i];
      return { x: s.x + (this.rng() - 0.5) * 0.8, y: s.y + (this.rng() - 0.5) * 0.8, heading: this.rng() * Math.PI * 2, ext: 0, want: 0, phase: this.rng() * 6.28, spot: i, lot: this.rng() };
    });
  }

  /** The yard changed (the month turned, a plant grew, a bed was drawn): flowers and worm ground are new. */
  setWorld(world: LifeWorld) {
    const monthChanged = world.month !== this.world.month;
    const spotsChanged = world.wormSpots.length !== this.world.wormSpots.length || monthChanged;
    this.world = world;
    if (spotsChanged) this.makeWorms();
    this.retarget();
  }

  setClock(d: Daylight) {
    this.daylight = d;
    this.retarget();
  }

  /** Who should be about now, given the month, the time of day and what is in bloom. */
  private retarget() {
    const nh = hummerCount(this.world, this.daylight, this.cfg.hummer);
    this.hummers.forEach((h, i) => (h.wanted = i < nh));
    const nb = butterflyCount(this.world, this.daylight, this.cfg.butterfly);
    this.butterflies.forEach((b, i) => (b.wanted = i < nb));
    this.assignBirds();
    const wc = this.cfg.worms;
    for (const w of this.worms) {
      const spot = this.world.wormSpots[w.spot];
      w.want = spot && w.lot < wormUpChance(this.world.month, this.daylight.minutes, spot.shade, wc) ? 1 : 0;
    }
  }

  step(dt: number) {
    this.t += dt;
    this.stepHummers(dt);
    this.stepButterflies(dt);
    this.stepWorms(dt);
    this.stepBirds(dt);
  }


  private stepBirds(dt: number) {
    const c = this.cfg.birds;
    const w = this.world;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.vis = Math.max(0, Math.min(1, b.vis + (b.wanted ? 1 : -1) * (dt / c.fadeS)));
      if (!b.species || (b.vis <= 0 && !b.wanted)) continue;
      const sp = c.species.find((x) => x.id === b.species)!;
      b.timer -= dt;
      const speed = c.speedFt[0] + ((b.phase * 7.3) % 1) * (c.speedFt[1] - c.speedFt[0]);
      if (b.state === 'fly') {
        const t = b.target!;
        const arrived = this.fly(b, t, speed, dt);
        // A ground feeder hops along rather than flying the last stretch.
        if (arrived) {
          b.state = t.ground || sp.guild === 'fruit' || sp.guild === 'nectar' ? 'forage' : 'perch';
          b.timer = between(this.rng, t.ground ? c.forageS : c.perchS);
          b.z = t.z;
        }
        continue;
      }
      if (b.state === 'forage' && sp.guild === 'ground') {
        // Hop about a little, pecking, until it is time to go.
        b.z = c.hopFt * Math.max(0, Math.sin(this.t * 7 + b.phase));
        const nx = b.x + Math.cos(b.heading) * dt * 0.25, ny = b.y + Math.sin(b.heading) * dt * 0.25;
        if (!this.insideStructure(nx, ny)) { b.x = nx; b.y = ny; } else b.heading += Math.PI;
        if (this.rng() < dt * 0.4) b.heading += (this.rng() - 0.5) * 2.4;
      }
      if (b.timer > 0) continue;
      // Time to move: choose where next, a flock keeping near its leader.
      const lead = this.birds[b.leader];
      const near = (x: number, y: number) => ({ x: x + (this.rng() - 0.5) * 2.4, y: y + (this.rng() - 0.5) * 2.4 });
      let next: Bird['target'] = null;
      if (sp.guild === 'ground') {
        const spots = w.wormSpots;
        const s0 = lead.target && b !== lead && lead.target.ground ? lead.target : null;
        const spot = spots[Math.floor(this.rng() * spots.length)];
        const p = s0 ? near(s0.x, s0.y) : { x: spot.x, y: spot.y };
        next = { x: p.x, y: p.y, z: 0, ground: true };
      } else if (sp.guild === 'fruit' && w.birdFood.length) {
        const f = w.birdFood[Math.floor(this.rng() * w.birdFood.length)];
        const q = this.onPlant(f, f.height * 0.85);
        const p = b !== lead && lead.target ? near(lead.target.x, lead.target.y) : q;
        next = { x: p.x, y: p.y, z: b !== lead && lead.target ? lead.target.z : q.z, ground: false };
      } else if (sp.guild === 'nectar') {
        const flowers = w.flowers.filter((f) => f.groups.includes('hummingbirds'));
        const f = flowers.length ? flowers[Math.floor(this.rng() * flowers.length)] : null;
        const q = f ? this.onPlant(f, f.height * 0.9) : null;
        next = q ? { ...q, ground: false } : null;
      } else {
        const p = w.perches.length ? w.perches[Math.floor(this.rng() * w.perches.length)] : null;
        const q = p && b !== lead && lead.target && !lead.target.ground ? near(lead.target.x, lead.target.y) : p ? { x: p.x, y: p.y } : null;
        // a shrub or tree: on its top, or settled in among the branches
        const inside = p && this.rng() < 0.4;
        next = p && q ? { x: inside ? p.x + (this.rng() - 0.5) * p.r * 0.5 : q.x, y: inside ? p.y + (this.rng() - 0.5) * p.r * 0.5 : q.y, z: inside ? p.z * 0.6 : p.z, ground: false } : null;
      }
      if (!next) { b.timer = between(this.rng, c.perchS); continue; }
      b.target = next;
      b.state = 'fly';
    }
  }

  private stepHummers(dt: number) {
    const c = this.cfg.hummer;
    const flowers = this.world.flowers.filter((f) => f.groups.includes('hummingbirds'));
    for (const h of this.hummers) {
      h.vis = Math.max(0, Math.min(1, h.vis + (h.wanted ? 1 : -1) * (dt / c.fadeS)));
      if (h.vis <= 0 && !h.wanted) continue;
      h.timer -= dt;
      if (h.state === 'perch') {
        const p = this.world.perches.length ? this.world.perches[Math.floor(this.rng() * this.world.perches.length)] : null;
        if (!h.target) h.target = p ? { x: p.x, y: p.y, z: p.z + 0.3 } : { x: h.x, y: h.y, z: 5 };
        this.fly(h, h.target, between(this.rng, c.speedFt) * 0.6, dt);
        if (h.timer <= 0) {
          const f = flowers.length ? flowers[Math.floor(this.rng() * flowers.length)] : null;
          if (f) {
            h.state = 'dart';
            h.target = this.onPlant(f, f.height * 0.85 + 0.2);
          } else h.timer = between(this.rng, c.perchS);
        }
      } else if (h.state === 'dart') {
        const arrived = this.fly(h, h.target!, between(this.rng, c.speedFt), dt);
        if (arrived) {
          h.state = 'feed';
          h.timer = between(this.rng, c.hoverS);
        }
      } else {
        // hovering at the flower, bobbing a little
        h.z = h.target!.z + Math.sin(this.t * 9 + h.phase) * c.bobFt;
        if (h.timer <= 0) {
          const next = flowers.length > 1 && this.rng() < 0.6 ? flowers[Math.floor(this.rng() * flowers.length)] : null;
          if (next) {
            h.state = 'dart';
            h.target = this.onPlant(next, next.height * 0.85 + 0.2);
          } else {
            h.state = 'perch';
            h.target = null;
            h.timer = between(this.rng, c.perchS);
          }
        }
      }
    }
  }

  /** Move toward a target at a speed; true on arrival. */
  private fly(o: { x: number; y: number; z: number; heading: number }, to: { x: number; y: number; z: number }, speed: number, dt: number): boolean {
    const dx = to.x - o.x, dy = to.y - o.y, dz = to.z - o.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.08) return true;
    const move = Math.min(d, speed * dt);
    o.x += (dx / d) * move;
    o.y += (dy / d) * move;
    o.z += (dz / d) * move;
    if (Math.hypot(dx, dy) > 0.05) o.heading = Math.atan2(dy, dx);
    // Never through a roof or a wall: climb and pass over.
    keepOutOfStructures(this.world, o, dt);
    return d - move < 0.08;
  }

  private stepButterflies(dt: number) {
    const c = this.cfg.butterfly;
    const flowers = butterflyFlowers(this.world, c);
    for (const b of this.butterflies) {
      b.vis = Math.max(0, Math.min(1, b.vis + (b.wanted ? 1 : -1) * (dt / c.fadeS)));
      if (b.vis <= 0 && !b.wanted) continue;
      b.timer -= dt;
      if (b.state === 'land') {
        if (b.timer <= 0) { b.state = 'flutter'; b.target = null; }
        continue;
      }
      if (!b.target || b.timer <= 0) {
        const f = flowers.length && this.rng() < 0.75 ? flowers[Math.floor(this.rng() * flowers.length)] : null;
        b.target = f
          ? this.onPlant(f, f.height * 0.9 + 0.15)
          : (() => { const [x, y] = this.openPoint(); return { x, y, z: between(this.rng, c.altFt) }; })();
        b.timer = 12;
      }
      // An uneven, fluttering flight: it drifts off line and bobs.
      const wobble = Math.sin(this.t * 2.1 + b.phase) * 0.9;
      const goal = { x: b.target.x + Math.cos(b.heading + 1.57) * wobble, y: b.target.y + Math.sin(b.heading + 1.57) * wobble, z: b.target.z + Math.sin(this.t * 3.3 + b.phase) * 0.4 };
      const arrived = this.fly(b, goal, b.speed, dt);
      const dist = Math.hypot(b.target.x - b.x, b.target.y - b.y);
      if (arrived && dist < 0.8) {
        const onFlower = flowers.some((f) => Math.hypot(f.x - b.target!.x, f.y - b.target!.y) <= f.radius + 0.6);
        if (onFlower) {
          b.state = 'land';
          b.timer = between(this.rng, c.landS);
          b.x = b.target.x;
          b.y = b.target.y;
          b.z = b.target.z;
        } else b.timer = 0;
      }
    }
  }

  private stepWorms(dt: number) {
    const rate = this.cfg.worms.emergeRate * dt;
    for (const w of this.worms) w.ext += Math.max(-rate, Math.min(rate, w.want - w.ext));
  }
}
