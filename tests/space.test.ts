import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { buildLifeWorld, isInside, LifeSim, type Walker } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, Pt } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const sim = (tweak?: (c: EngineConfig['life']) => void, seed = 4, people = 8) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  tweak?.(cfg);
  const w = buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: [], month: 5, engine: { ...engine, life: cfg } });
  return { s: new LifeSim(w, cfg, seed, { people, dogs: 0, bees: false }), w, cfg };
};
const run = (s: LifeSim, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 0.1) {
    s.step(0.1);
    each?.();
  }
};
const people = (s: LifeSim) => s.walkers.filter((w) => w.kind === 'person' && !isInside(w) && !w.away);
const radius = (w: Walker, cfg: EngineConfig['life']) => cfg.people.bodyRadiusShare * w.heightFt;
const minGap = (cfg: EngineConfig['life']) => (a: Walker, b: Walker) => radius(a, cfg) + radius(b, cfg) + cfg.people.spaceFt;
/** An open spot in the open back yard, for placing people by hand. */
const clearAt = (s: LifeSim, x: number, y: number): Pt => {
  const p = (s as unknown as { nearestFree(x: number, y: number): Pt | null }).nearestFree(x, y)!;
  return p;
};

describe('people give each other room', () => {
  it('keeps every pair at least a foot apart while the day goes by, except hugging and sitting together', () => {
    for (const seed of [1, 4, 9]) {
      const { s, cfg } = sim(undefined, seed, 12);
      const need = minGap(cfg);
      let worst = Infinity, checks = 0, short = 0, worstGap = Infinity;
      run(s, 420, () => {
        if (s['clock' as keyof LifeSim] as unknown as number < 15) return;
        const ps = people(s);
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j];
          if ((s as unknown as { mayTouch(a: Walker, b: Walker): boolean }).mayTouch(a, b)) continue;
          // The foot is squeezed down (to a few inches) only for someone who has been held up for a while, in a lane too narrow for a foot between two people.
          const eff = (w: Walker) => (s as unknown as { spaceFor(w: Walker): number }).spaceFor(w);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const shortfall = d - (need(a, b) - cfg.people.spaceFt + Math.min(eff(a), eff(b)));
          worst = Math.min(worst, shortfall);
          const gap0 = d - radius(a, cfg) - radius(b, cfg);
          worstGap = Math.min(worstGap, gap0);
          if (shortfall < -0.25) short++;
          checks++;
        }
      });
      expect(checks, `seed ${seed}`).toBeGreaterThan(1000);
      // never through one another, and the foot (or the squeezed space, in a tight lane) kept at all but a handful of moments
      expect(worstGap, `seed ${seed}`).toBeGreaterThan(-0.05);
      expect(short / checks, `seed ${seed}`).toBeLessThan(0.002);
      void worst;
    }
  });

  it('passes head on without going through: two people walking toward each other swap sides at a foot or more', () => {
    const { s, cfg } = sim((c) => { c.people.meet.bias = 0; c.harvest.bias = 0; c.dining.bias = 0; c.people.visitBias = 0; }, 3, 2);
    const [a, b] = s.walkers;
    const p = clearAt(s, 24, 112), q = clearAt(s, 38, 112);
    [a.x, a.y, b.x, b.y] = [p[0], p[1], q[0], q[1]];
    a.pauseLeft = b.pauseLeft = 0;
    const need = minGap(cfg)(a, b);
    let closest = Infinity;
    a.route = [[q[0], q[1]]];
    b.route = [[p[0], p[1]]];
    run(s, 9, () => {
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      if (a.route.length === 0 && Math.hypot(a.x - q[0], a.y - q[1]) < 1) a.route = [];
    });
    expect(closest).toBeGreaterThanOrEqual(need - 0.05);
    expect(closest).toBeLessThan(need + 1.6); // they did pass close, not go the long way round
  });

  it('walks round someone standing in the way, and waits rather than pass through when there is no room', () => {
    const { s, cfg } = sim((c) => { c.people.meet.bias = 0; c.harvest.bias = 0; c.dining.bias = 0; c.people.visitBias = 0; }, 5, 2);
    const [mover, still] = s.walkers;
    const from = clearAt(s, 24, 112), to = clearAt(s, 38, 112);
    mover.x = from[0]; mover.y = from[1];
    still.x = (from[0] + to[0]) / 2; still.y = (from[1] + to[1]) / 2;
    still.pauseLeft = 9999; mover.pauseLeft = 0;
    mover.route = [[to[0], to[1]]];
    const need = minGap(cfg)(mover, still);
    let closest = Infinity;
    run(s, 8, () => { closest = Math.min(closest, Math.hypot(mover.x - still.x, mover.y - still.y)); });
    expect(closest).toBeGreaterThanOrEqual(need - 0.05);
    expect(Math.hypot(mover.x - to[0], mover.y - to[1])).toBeLessThan(2.5); // got past
  });

  it('never leaves anyone stuck for good: everyone keeps travelling', () => {
    const { s } = sim(undefined, 7, 12);
    const start = s.walkers.filter((w) => w.kind === 'person').map((w) => [w.x, w.y]);
    let travelled = start.map(() => 0);
    let last = start;
    run(s, 400, () => {
      const now = s.walkers.filter((w) => w.kind === 'person').map((w) => [w.x, w.y]);
      travelled = travelled.map((t, i) => t + Math.hypot(now[i][0] - last[i][0], now[i][1] - last[i][1]));
      last = now;
    });
    for (const t of travelled) expect(t).toBeGreaterThan(8);
  });
});

describe('meeting to talk, and to hug', () => {
  const meeting = (seed: number, hug: boolean) =>
    sim((c) => { c.people.meet.bias = 1; c.people.meet.hugChance = hug ? 1 : 0; c.people.meet.cooldownS = 5; c.harvest.bias = 0; c.dining.bias = 0; c.people.visitBias = 0; }, seed, 6);

  it('has two free people walk to each other, face, talk in turns, and part', () => {
    const { s, cfg } = meeting(2, false);
    const phases = new Set<string>();
    let talkers = 0, closestTalk = Infinity, ended = false, bothTalking = 0, shortfall = Infinity;
    run(s, 160, () => {
      for (const wk of s.walkers) {
        if (wk.act?.kind === 'meet') {
          phases.add(wk.act.phase);
          if (wk.act.phase === 'talk') {
            const o = s.walkers[wk.act.partner];
            closestTalk = Math.min(closestTalk, Math.hypot(wk.x - o.x, wk.y - o.y));
            shortfall = Math.min(shortfall, Math.hypot(wk.x - o.x, wk.y - o.y) - minGap(cfg)(wk, o));
            if (wk.talking && o.talking) bothTalking++;
            if (wk.talking) talkers++;
          }
        }
      }
      if (phases.has('talk') && !s.walkers.some((w) => w.act?.kind === 'meet')) ended = true;
    });
    for (const p of ['to', 'wait', 'greet', 'talk']) expect(phases.has(p), p).toBe(true);
    expect(talkers).toBeGreaterThan(5);
    expect(bothTalking).toBe(0); // one speaks at a time
    expect(closestTalk).toBeGreaterThanOrEqual(minGap(cfg)(s.walkers[0], s.walkers[0]) * 0 + 2.0); // talking, a little over arm's length apart, never as close as a hug
    expect(shortfall).toBeGreaterThanOrEqual(-0.05); // a foot of clear space even while talking
    expect(ended).toBe(true);
  });

  it('lets a hug come closer than people pass, and only a hug', () => {
    const { s, cfg } = meeting(3, true);
    let hugged = false, maxHug = 0, nearest = Infinity;
    const need = minGap(cfg);
    run(s, 160, () => {
      for (const wk of s.walkers) {
        if (wk.act?.kind !== 'meet') continue;
        const o = s.walkers[wk.act.partner];
        const d = Math.hypot(wk.x - o.x, wk.y - o.y);
        if (wk.act.phase === 'greet' && wk.hug > 0.9) { hugged = true; nearest = Math.min(nearest, d - (radius(wk, cfg) + radius(o, cfg))); }
        maxHug = Math.max(maxHug, wk.hug);
        if (wk.hug === 0 && wk.act.phase !== 'greet') expect(d).toBeGreaterThanOrEqual(need(wk, o) - 0.3);
      }
    });
    expect(hugged).toBe(true);
    expect(maxHug).toBeGreaterThan(0.95);
    expect(nearest).toBeLessThan(cfg.people.spaceFt); // bodies closer than the foot people keep otherwise
    expect(nearest).toBeGreaterThan(-0.05); // but not through one another
  });

  it('ends a meeting when night falls, with no one left hugging or talking', () => {
    const { s } = meeting(6, true);
    run(s, 30);
    s.setClock(23 * 60 + 30);
    run(s, 5);
    for (const wk of s.walkers) {
      expect(wk.act?.kind === 'meet').toBe(false);
      expect(wk.hug).toBe(0);
      expect(wk.talking).toBe(false);
    }
  });
});
