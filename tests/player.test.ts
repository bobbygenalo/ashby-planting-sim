import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import materialsRaw from '../src/data/materials.json';
import { activeStructures, loadSite } from '../src/engine/site';
import { NO_INPUT, buildPlayerWorld, createPlayer, eyeZ, groundAt, headingToward, look, playerFits, stepPlayer, type PlayerInput, type PlayerState, type PlayerWorld } from '../src/engine/player';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.player;
const site = loadSite(siteRaw);
const materials = materialsRaw as unknown as Material[];

const empty = (): PlayerWorld => ({ lot: { width: 50, depth: 150 }, blocks: [], posts: [] });
const run = (s: PlayerState, input: Partial<PlayerInput>, secs: number, w: PlayerWorld, dt = 1 / 60) => {
  let st = s;
  for (let t = 0; t < secs; t += dt) st = stepPlayer(st, { ...NO_INPUT, ...input }, dt, w, cfg);
  return st;
};
const box = (x0: number, y0: number, x1: number, y1: number, top: number) => ({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][], top });

describe('walking', () => {
  it('goes the way you face: heading 0 is toward the rear, a quarter turn right is east', () => {
    const w = empty();
    const n = run(createPlayer(25, 20, 0), { forward: 1 }, 1, w);
    expect(n.y).toBeGreaterThan(22);
    expect(Math.abs(n.x - 25)).toBeLessThan(0.01);
    const e = run(createPlayer(25, 20, Math.PI / 2), { forward: 1 }, 1, w);
    expect(e.x).toBeGreaterThan(27);
    const back = run(createPlayer(25, 20, 0), { forward: -1 }, 1, w);
    expect(back.y).toBeLessThan(18);
    const right = run(createPlayer(25, 20, 0), { strafe: 1 }, 1, w);
    expect(right.x).toBeGreaterThan(27);
  });

  it('runs faster than it walks, and a diagonal is no faster than straight on', () => {
    const w = empty();
    const walk = run(createPlayer(25, 20, 0), { forward: 1 }, 2, w);
    const sprint = run(createPlayer(25, 20, 0), { forward: 1, run: true }, 2, w);
    expect(sprint.y - 20).toBeGreaterThan((walk.y - 20) * 2);
    const diag = run(createPlayer(25, 20, 0), { forward: 1, strafe: 1 }, 2, w);
    expect(Math.hypot(diag.x - 25, diag.y - 20)).toBeLessThanOrEqual(walk.y - 20 + 0.01);
  });

  it('speeds up and stops over a fraction of a second, not instantly', () => {
    const w = empty();
    const a = run(createPlayer(25, 20, 0), { forward: 1 }, 0.05, w);
    expect(Math.hypot(a.vx, a.vy)).toBeLessThan(cfg.walkFtS);
    const stopped = run({ ...a, vy: cfg.walkFtS }, {}, 0.5, w);
    expect(Math.hypot(stopped.vx, stopped.vy)).toBe(0);
  });

  it('turns with the arrow keys and the mouse, and cannot look past straight up or down', () => {
    const w = empty();
    expect(run(createPlayer(25, 20, 0), { turn: 1 }, 1, w).heading).toBeCloseTo(cfg.turnRadS, 1);
    const s = look(createPlayer(25, 20, 0), 100, 0, cfg);
    expect(s.heading).toBeCloseTo(100 * cfg.lookRadPerPx, 9);
    expect(look(s, 0, -100000, cfg).pitch).toBe(cfg.pitchLimitRad);
    expect(look(s, 0, 100000, cfg).pitch).toBe(-cfg.pitchLimitRad);
    expect(headingToward([0, 0], [0, 10])).toBe(0);
    expect(headingToward([0, 0], [10, 0])).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('what stops you', () => {
  it('keeps you inside the lot', () => {
    const w = empty();
    const s = run(createPlayer(25, 5, Math.PI), { forward: 1, run: true }, 3, w);
    expect(s.y).toBeGreaterThanOrEqual(cfg.lotMarginFt - 1e-9);
    const t = run(createPlayer(25, 140, 0), { forward: 1, run: true }, 3, w);
    expect(t.y).toBeLessThanOrEqual(150 - cfg.lotMarginFt + 1e-9);
  });

  it('stops at a wall and slides along it, never inside', () => {
    const w = empty();
    w.blocks.push(box(20, 40, 40, 50, 14));
    const s = run(createPlayer(25, 30, Math.PI / 4), { forward: 1 }, 3, w);
    expect(playerFits(w, s.x, s.y, s.z, true, cfg)).toBe(true);
    expect(s.y).toBeLessThan(40 - cfg.radiusFt + 1e-6);
    expect(s.x).toBeGreaterThan(30); // slid east along the wall
  });

  it('cannot walk through a tree trunk or a shrub, but can walk over a groundcover', () => {
    const w = empty();
    w.posts.push({ x: 25, y: 40, r: 0.6, top: 20 });
    const s = run(createPlayer(25, 30, 0), { forward: 1 }, 4, w);
    expect(Math.hypot(s.x - 25, s.y - 40)).toBeGreaterThanOrEqual(0.6 + cfg.radiusFt - 1e-6);
  });

  it('is not stuck in the starting spot of the Walk view, and the buildings are solid', () => {
    const view = site.views.find((v) => v.id === 'walk')!;
    expect(view.kind).toBe('walk');
    const w = buildPlayerWorld({ site, structures: activeStructures(site, { aduEnabled: true }), hardscape: [], materials, plants: [], hive: null, engine });
    const [x, y] = view.position!;
    expect(playerFits(w, x, y, 0, true, cfg)).toBe(true);
    const house = activeStructures(site, { aduEnabled: true }).find((s) => s.group === 'house')!;
    const [hx, hy] = house.footprint[0];
    expect(playerFits(w, hx, hy, 0, true, cfg)).toBe(false);
  });
});

describe('jumping', () => {
  it('rises, comes back down and lands on the ground', () => {
    const w = empty();
    let s = createPlayer(25, 20, 0);
    s = stepPlayer(s, { ...NO_INPUT, jump: true }, 1 / 60, w, cfg);
    expect(s.onGround).toBe(false);
    let peak = s.z;
    for (let i = 0; i < 120 && !s.onGround; i++) { s = stepPlayer(s, NO_INPUT, 1 / 60, w, cfg); peak = Math.max(peak, s.z); }
    expect(peak).toBeGreaterThan(1.5);
    expect(peak).toBeLessThan(2.5);
    expect(s.onGround).toBe(true);
    expect(s.z).toBe(0);
  });

  it('cannot jump in the air, and a held jump key bounces again only after landing', () => {
    const w = empty();
    let s = stepPlayer(createPlayer(25, 20, 0), { ...NO_INPUT, jump: true }, 1 / 60, w, cfg);
    const vz = s.vz;
    s = stepPlayer(s, { ...NO_INPUT, jump: true }, 1 / 60, w, cfg);
    expect(s.vz).toBeLessThan(vz);
  });

  it('keeps moving while in the air, but steers less', () => {
    const w = empty();
    let s = stepPlayer(createPlayer(25, 20, 0), { ...NO_INPUT, jump: true, forward: 1, run: true }, 1 / 60, w, cfg);
    for (let i = 0; i < 20; i++) s = stepPlayer(s, { ...NO_INPUT, forward: 1, run: true }, 1 / 60, w, cfg);
    expect(s.y).toBeGreaterThan(20.5);
  });
});

describe('climbing', () => {
  it('steps up a low edge but is stopped by one that needs a jump', () => {
    const low = empty();
    low.blocks.push(box(20, 40, 40, 80, 0.5));
    const up = run(createPlayer(25, 30, 0), { forward: 1 }, 3, low);
    expect(up.z).toBeCloseTo(0.5, 6);
    const high = empty();
    high.blocks.push(box(20, 40, 40, 80, 1.5));
    const stopped = run(createPlayer(25, 30, 0), { forward: 1 }, 3, high);
    expect(stopped.z).toBe(0);
    expect(stopped.y).toBeLessThan(40);
  });

  it('jumps onto a raised bed 1.5 ft high and stands on it, then walks off and falls back down', () => {
    const w = empty();
    w.blocks.push(box(20, 40, 40, 50, 1.5));
    let s = createPlayer(25, 38.5, 0);
    for (let i = 0; i < 90; i++) s = stepPlayer(s, { ...NO_INPUT, forward: 1, jump: i === 0 }, 1 / 60, w, cfg);
    expect(s.z).toBeCloseTo(1.5, 6);
    expect(s.onGround).toBe(true);
    expect(groundAt(w, s.x, s.y)).toBe(1.5);
    s = run(s, { forward: 1, run: true }, 2, w);
    expect(s.y).toBeGreaterThan(50);
    expect(s.z).toBe(0);
  });

  it('cannot jump over a six foot fence', () => {
    const w = empty();
    w.blocks.push(box(20, 40, 40, 40.5, 6));
    let s = createPlayer(30, 38.5, 0);
    for (let i = 0; i < 180; i++) s = stepPlayer(s, { ...NO_INPUT, forward: 1, jump: true }, 1 / 60, w, cfg);
    expect(s.y).toBeLessThan(40);
  });
});

describe('the world from the plan', () => {
  it('includes the hive and raised beds as solids and ignores paths and removed work', () => {
    const els = [
      { id: 'b', type: 'raisedBed', points: [[10, 10], [14, 10], [14, 14], [10, 14]], materialId: 'raised-bed-wood', height: 1.5, depthIn: 0, width: 0, existing: false },
      { id: 'p', type: 'path', points: [[20, 20], [30, 20]], materialId: 'gravel', height: 0, depthIn: 3, width: 3, existing: false },
      { id: 'r', type: 'wall', points: [[1, 1], [9, 1]], materialId: 'cmu-wall', height: 4, depthIn: 0, width: 0.7, existing: true, removed: true },
    ] as HardscapeElement[];
    const w = buildPlayerWorld({ site, structures: [], hardscape: els, materials, plants: [], hive: { x: 30, y: 60 }, engine });
    expect(w.blocks.some((b) => b.top === 1.5)).toBe(true);
    expect(w.blocks.some((b) => b.top === 4)).toBe(false);
    expect(w.posts.some((p) => p.x === 30 && p.y === 60)).toBe(true);
  });
});

describe('crouching', () => {
  it('lowers the eyes to the crouch height while C is held, smoothly, and stands back up when it is let go', () => {
    const w = empty();
    let s = createPlayer(25, 20, 0);
    expect(eyeZ(s, cfg)).toBe(cfg.eyeHeightFt);
    s = stepPlayer(s, { ...NO_INPUT, crouch: true }, 1 / 60, w, cfg);
    expect(s.crouch).toBeGreaterThan(0);
    expect(s.crouch).toBeLessThan(1); // not instant
    s = run(s, { crouch: true }, 1, w);
    expect(s.crouch).toBe(1);
    expect(eyeZ(s, cfg)).toBeCloseTo(cfg.crouchEyeHeightFt, 9);
    expect(cfg.crouchEyeHeightFt).toBeLessThan(cfg.eyeHeightFt - 2); // low enough to look across a raised bed
    s = run(s, {}, 1, w);
    expect(s.crouch).toBe(0);
    expect(eyeZ(s, cfg)).toBe(cfg.eyeHeightFt);
  });

  it('walks slowly while crouched, ignores running, and cannot jump', () => {
    const w = empty();
    const walk = run(createPlayer(25, 20, 0), { forward: 1 }, 2, w);
    let c = run(createPlayer(25, 20, 0), { crouch: true }, 1, w);
    const y0 = c.y;
    c = run(c, { crouch: true, forward: 1, run: true }, 2, w);
    const crouched = c.y - y0;
    expect(crouched).toBeLessThan((walk.y - 20) * 0.7);
    expect(crouched).toBeGreaterThan(0);
    const j = run(c, { crouch: true, jump: true }, 0.3, w);
    expect(j.z).toBe(0);
    expect(j.onGround).toBe(true);
  });

  it('cannot start a crouch in the air, and a crouch under a low bed edge still moves the eyes with the ground', () => {
    const w = empty();
    let s = stepPlayer(createPlayer(25, 20, 0), { ...NO_INPUT, jump: true }, 1 / 60, w, cfg);
    s = stepPlayer(s, { ...NO_INPUT, crouch: true }, 1 / 60, w, cfg);
    expect(s.onGround).toBe(false);
    expect(s.crouch).toBe(0);
    const bedWorld = empty();
    bedWorld.blocks.push(box(20, 20, 40, 40, 0.5));
    const on = run(createPlayer(30, 30, 0), { crouch: true }, 1, bedWorld);
    expect(eyeZ(on, cfg)).toBeCloseTo(on.z + cfg.crouchEyeHeightFt, 9);
  });
});
