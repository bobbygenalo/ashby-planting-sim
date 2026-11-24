import { distanceToPolygon, pointInPolygon } from './geometry';
import { footprint } from './hardscape';
import type { PlacedPlant } from './growth';
import type { EngineConfig, HardscapeElement, Material, PlayerCfg, Pt, SiteConfig, StructureCfg } from './types';

/**
 * The first-person "Walk" view: a person standing in the yard. Pure functions, no React or three.js.
 * Heading is in the site plane: 0 faces the rear of the lot (+Y) and a positive turn is toward +X, so forward is
 * (sin h, cos h) and right is (cos h, -sin h).
 */
export interface PlayerState {
  x: number;
  y: number;
  /** Height of the feet above the ground. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  pitch: number;
  onGround: boolean;
  /** How far down in a crouch, 0 standing to 1 fully crouched. */
  crouch: number;
}

export interface PlayerInput {
  /** -1 back to 1 forward, and -1 left to 1 right. */
  forward: number;
  strafe: number;
  run: boolean;
  jump: boolean;
  /** Held to crouch. */
  crouch: boolean;
  /** -1 left to 1 right, from the arrow keys. */
  turn: number;
}

export const NO_INPUT: PlayerInput = { forward: 0, strafe: 0, run: false, jump: false, crouch: false, turn: 0 };

interface Block { poly: Pt[]; top: number }
interface Post { x: number; y: number; r: number; top: number }

/** What the player bumps into and climbs on. Built from the plan once per change, not every frame. */
export interface PlayerWorld {
  lot: { width: number; depth: number };
  /** Buildings, walls, raised beds, decks and furniture: solid up to `top`, and standable on top when low enough to climb. */
  blocks: Block[];
  /** Trunks, shrubs, poles and the hive: solid while the feet are lower than `top`. */
  posts: Post[];
}

export interface PlayerWorldInput {
  site: SiteConfig;
  structures: StructureCfg[];
  hardscape: HardscapeElement[];
  materials: Material[];
  plants: PlacedPlant[];
  hive: { x: number; y: number } | null;
  engine: EngineConfig;
}

export function buildPlayerWorld(inp: PlayerWorldInput): PlayerWorld {
  const { engine } = inp;
  const pc = engine.player;
  const blocks: Block[] = [];
  const posts: Post[] = [];
  for (const s of inp.structures) blocks.push({ poly: s.footprint, top: Math.max(s.ridgeHeight, s.eaveHeight) });
  for (const o of inp.site.contextObjects) {
    if (o.kind === 'building' && o.footprint) blocks.push({ poly: o.footprint, top: o.height });
    else if (o.kind === 'tree' && o.position) posts.push({ x: o.position[0], y: o.position[1], r: 0.9, top: o.height });
    else if (o.kind === 'pole' && o.position) posts.push({ x: o.position[0], y: o.position[1], r: 0.4, top: o.height });
  }
  for (const e of inp.hardscape) {
    if (e.removed || e.type === 'path' || e.height < 0.5) continue;
    blocks.push({ poly: footprint(e, engine.hardscape), top: e.height });
  }
  for (const p of inp.plants) {
    const h = p.size.height, w = p.size.width;
    const top = h * pc.plantClearShare;
    // Low plants are stepped over; trees block at the trunk, shrubs a little inside their foliage.
    if (top <= pc.stepUpFt) continue;
    const trunked = (engine.growth.trunkClearanceFraction[p.species.type] ?? 0) > 0;
    const r = trunked ? Math.min(1, 0.3 + 0.012 * h) : Math.max(0.3, pc.plantBlockShare * w / 2);
    posts.push({ x: p.inst.position[0], y: p.inst.position[1], r, top });
  }
  if (inp.hive) posts.push({ x: inp.hive.x, y: inp.hive.y, r: 1.2, top: 3.5 });
  return { lot: { width: inp.site.lot.width, depth: inp.site.lot.depth }, blocks, posts };
}

/** The height of the ground under a point: the top of any raised bed, deck or similar it stands on, else 0. */
export function groundAt(w: PlayerWorld, x: number, y: number): number {
  let g = 0;
  for (const b of w.blocks) if (b.top > g && pointInPolygon(x, y, b.poly)) g = b.top;
  return g;
}

/** Whether the body (a disc of `radius`) at (x, y) with its feet at `z` is clear of everything. */
export function playerFits(w: PlayerWorld, x: number, y: number, z: number, onGround: boolean, cfg: PlayerCfg): boolean {
  const m = cfg.lotMarginFt;
  if (x < m || y < m || x > w.lot.width - m || y > w.lot.depth - m) return false;
  const reach = z + (onGround ? cfg.stepUpFt : 0.05);
  for (const b of w.blocks) {
    if (b.top <= reach) continue;
    if (pointInPolygon(x, y, b.poly) || distanceToPolygon(x, y, b.poly) < cfg.radiusFt) return false;
  }
  for (const p of w.posts) {
    if (z >= p.top) continue;
    if (Math.hypot(x - p.x, y - p.y) < p.r + cfg.radiusFt) return false;
  }
  return true;
}

export function createPlayer(x: number, y: number, heading: number): PlayerState {
  return { x, y, z: 0, vx: 0, vy: 0, vz: 0, heading, pitch: 0, onGround: true, crouch: 0 };
}

/** The heading that faces from one point toward another. */
export function headingToward(from: Pt, to: Pt): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** Turn the view by a mouse drag (positive dx turns right, positive dy looks down). */
export function look(s: PlayerState, dxPx: number, dyPx: number, cfg: PlayerCfg): PlayerState {
  const pitch = Math.max(-cfg.pitchLimitRad, Math.min(cfg.pitchLimitRad, s.pitch - dyPx * cfg.lookRadPerPx));
  return { ...s, heading: s.heading + dxPx * cfg.lookRadPerPx, pitch };
}

/** Advance the player by `dt` seconds: steer, accelerate, slide along obstacles, jump, fall and land. */
export function stepPlayer(s0: PlayerState, input: PlayerInput, dt: number, w: PlayerWorld, cfg: PlayerCfg): PlayerState {
  const s = { ...s0 };
  s.heading += input.turn * cfg.turnRadS * dt;
  // The wish direction in the plane, at walking or running speed (diagonals are not faster).
  const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
  let wx = sin * input.forward + cos * input.strafe;
  let wy = cos * input.forward - sin * input.strafe;
  const mag = Math.hypot(wx, wy);
  if (mag > 1) { wx /= mag; wy /= mag; }
  // Crouching comes on and off smoothly, only on the ground; a crouched person walks slowly and cannot run or jump.
  const crouchTarget = input.crouch && s.onGround ? 1 : s.onGround ? 0 : s.crouch;
  s.crouch += Math.max(-cfg.crouchRate * dt, Math.min(cfg.crouchRate * dt, crouchTarget - s.crouch));
  const base = input.run && s.crouch < 0.2 ? cfg.runFtS : cfg.walkFtS;
  const speed = base * (1 - (1 - cfg.crouchSpeedShare) * s.crouch);
  const acc = (s.onGround ? cfg.groundAccel : cfg.airAccel) * dt;
  // Change the velocity toward the wish by at most `acc`, as one vector so a diagonal is no quicker than straight on.
  const dvx = wx * speed - s.vx, dvy = wy * speed - s.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv <= acc) { s.vx += dvx; s.vy += dvy; } else { s.vx += (dvx / dv) * acc; s.vy += (dvy / dv) * acc; }

  // Jump from the ground.
  if (input.jump && s.onGround && s.crouch < 0.3) { s.vz = cfg.jumpFtS; s.onGround = false; }

  // Move one axis at a time so a wall is slid along, not stuck to.
  const nx = s.x + s.vx * dt;
  if (playerFits(w, nx, s.y, s.z, s.onGround, cfg)) s.x = nx; else s.vx = 0;
  const ny = s.y + s.vy * dt;
  if (playerFits(w, s.x, ny, s.z, s.onGround, cfg)) s.y = ny; else s.vy = 0;

  // Up and down: climb a low edge, fall off a high one, land on the ground or on top of a bed.
  const ground = groundAt(w, s.x, s.y);
  if (s.onGround) {
    if (ground > s.z + 1e-6 && ground - s.z <= cfg.stepUpFt + 1e-6) s.z = ground; // stepped up
    else if (ground < s.z - 1e-6) s.onGround = false; // walked off an edge
  }
  if (!s.onGround) {
    s.vz -= cfg.gravityFtS2 * dt;
    s.z += s.vz * dt;
    const g2 = groundAt(w, s.x, s.y);
    if (s.z <= g2 && s.vz <= 0) { s.z = g2; s.vz = 0; s.onGround = true; }
  }
  return s;
}

/** Where the eyes are above the ground: standing, lowered smoothly as the person crouches. */
export function eyeZ(s: PlayerState, cfg: PlayerCfg): number {
  return s.z + cfg.eyeHeightFt + (cfg.crouchEyeHeightFt - cfg.eyeHeightFt) * s.crouch;
}
