import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { ageGroup } from '../src/engine/manner';
import { buildLifeWorld, findRoute, LifeSim, type Walker } from '../src/engine/life';
import { beamTriangle, coverage, inBeam } from '../src/engine/projector';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });

const make = (tweak?: (c: EngineConfig['life']) => void, people = 12, seed = 3) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  // Keep everything but the film out of these tests.
  cfg.people.visitBias = 0; cfg.dining.bias = 0; cfg.harvest.bias = 0; cfg.people.meet.bias = 0; cfg.people.manner.linger.bias = 0; cfg.people.manner.play.chaseBias = 0;
  cfg.movie.shadow.puppet.bias = 0;
  tweak?.(cfg);
  const w = buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: [], month: 5, engine: { ...engine, life: cfg } });
  const s = new LifeSim(w, cfg, seed, { people, dogs: 0, bees: false });
  s.setClock(21 * 60); // a film is showing
  return { s, w, cfg, sc: w.screen! };
};
const run = (s: LifeSim, seconds: number, each?: (t: number) => void) => {
  for (let t = 0; t < seconds; t += 0.1) { s.step(0.1); each?.(t); }
};
const free = (s: LifeSim, x: number, y: number): [number, number] => (s as unknown as { nearestFree(x: number, y: number): [number, number] }).nearestFree(x, y);
const people = (s: LifeSim) => s.walkers.filter((w) => w.kind === 'person');
/** Put someone still at a place; everyone else out of the way and watching. */
const park = (w: Walker, at: [number, number]) => { [w.x, w.y] = at; w.route = []; w.pauseLeft = 1e6; w.act = null; w.visit = null; w.speed = 0; };
const setup = (age: number, seed = 3, tweak?: (c: EngineConfig['life']) => void) => {
  const m = make(tweak, 8, seed);
  const [offender, ...rest] = people(m.s);
  // scatter the others as viewers beside the beam
  const tri = beamTriangle(m.sc.lens, m.sc.x, m.sc.y - m.sc.width / 2, m.sc.y + m.sc.width / 2);
  const spots = m.sc.spots.filter((p) => !inBeam(p[0], p[1], tri, 1.4));
  rest.forEach((o, i) => { park(o, spots[(i * 5) % spots.length] as [number, number]); o.act = { kind: 'watch', phase: 'watch', spot: spots[(i * 5) % spots.length] as [number, number] }; });
  offender.age = age;
  offender.heightFt = age < 13 ? 4.7 : 5.6;
  park(offender, free(m.s, m.sc.x + 6, m.sc.y));
  return { ...m, offender, rest, tri };
};

describe('the beam on the ground', () => {
  it('has viewing spots all outside it, with room to see round the shadow of anyone standing in it', () => {
    const { sc } = make();
    const tri = beamTriangle(sc.lens, sc.x, sc.y - sc.width / 2, sc.y + sc.width / 2);
    expect(sc.spots.length).toBeGreaterThanOrEqual(6);
    for (const p of sc.spots) expect(inBeam(p[0], p[1], tri, 1.4)).toBe(false);
  });
  it('costs extra to cross while a film shows, so routes go round it; and nothing extra when no film is on', () => {
    const { s, w, sc } = make();
    const tri = beamTriangle(sc.lens, sc.x, sc.y - sc.width / 2, sc.y + sc.width / 2);
    const a = free(s, sc.x + 7, sc.y - 9), b = free(s, sc.x + 7, sc.y + 9);
    const crossing = (r: [number, number][]) => r.filter((p) => inBeam(p[0], p[1], tri, 0)).length;
    expect(w.beamOn).toBe(true);
    const detour = findRoute(w, a, b)!;
    w.beamOn = false;
    const straight = findRoute(w, a, b)!;
    expect(crossing(straight)).toBeGreaterThan(crossing(detour));
    expect(crossing(detour)).toBeLessThanOrEqual(1);
    s.setClock(10 * 60);
    expect(w.beamOn).toBe(false);
  });
});

describe('a shadow on the screen', () => {
  it('appears when someone stands between the projector and the screen, and not when they stand aside', () => {
    const { s, sc, offender, tri } = setup(30);
    run(s, 0.5);
    const rect = { y0: sc.y - sc.width / 2, y1: sc.y + sc.width / 2, z0: sc.bottom, z1: sc.bottom + sc.height };
    expect(inBeam(offender.x, offender.y, tri, 0)).toBe(true);
    expect(coverage(s.screenShadows, rect)).toBeGreaterThan(0.04);
    park(offender, free(s, sc.x + 6, sc.y + 14));
    run(s, 0.5);
    expect(coverage(s.screenShadows, rect)).toBe(0);
    s.setClock(10 * 60);
    expect(s.screenShadows).toEqual([]);
  });
});

describe('waving at someone in the light', () => {
  it('waits four seconds: nobody waves before that', () => {
    const { s, rest } = setup(30);
    let early = false;
    run(s, 3.8, () => { if (rest.some((o) => o.shoo > 0)) early = true; });
    expect(early).toBe(false);
  });

  it('then the nearest people wave at them (at most three), looking their way, and keep at it while they stay', () => {
    const { s, rest, offender, cfg } = setup(30, 3, (c) => { c.movie.shadow.reactS = [60, 60]; });
    run(s, 4.6);
    const wavers = rest.filter((o) => o.shoo > 0);
    expect(wavers.length).toBeGreaterThanOrEqual(1);
    expect(wavers.length).toBeLessThanOrEqual(cfg.movie.shadow.maxShooers);
    for (const o of wavers) expect(o.shooAt).toBe(people(s).indexOf(offender));
    // they are the nearest ones
    const dist = (o: Walker) => Math.hypot(o.x - offender.x, o.y - offender.y);
    const farthestWaver = Math.max(...wavers.map(dist)), nearestSitter = Math.min(...rest.filter((o) => o.shoo <= 0).map(dist));
    expect(farthestWaver).toBeLessThanOrEqual(nearestSitter + 1e-6);
    // still going several seconds on
    run(s, 6);
    expect(rest.filter((o) => o.shoo > 0).length).toBeGreaterThanOrEqual(1);
  });

  it('stops once they are out of the light', () => {
    const { s, rest, offender, sc, tri } = setup(30);
    run(s, 30);
    expect(inBeam(offender.x, offender.y, tri, 0)).toBe(false);
    expect(offender.shadowS).toBe(0);
    run(s, 2);
    expect(rest.every((o) => o.shoo === 0)).toBe(true);
    expect(Math.abs(offender.y - sc.y)).toBeGreaterThan(0.5);
  });

  it('grown-ups step out soon after being waved at; kids, who forget, take longer, and teens in between', () => {
    const leaveTime = (age: number, seed: number) => {
      const { s, offender, tri } = setup(age, seed);
      let t = 0;
      for (; t < 40; t += 0.1) {
        s.step(0.1);
        if (!inBeam(offender.x, offender.y, tri, 0)) break;
      }
      return t;
    };
    const avg = (age: number) => [1, 2, 3, 4, 5, 6].reduce((tot, sd) => tot + leaveTime(age, sd), 0) / 6;
    const adult = avg(30), kid = avg(9);
    expect(adult).toBeGreaterThan(4); // never before the four seconds are up
    expect(adult).toBeLessThan(11);
    expect(kid).toBeGreaterThan(adult + 3);
    expect(kid).toBeLessThan(26);
  });

  it('does not nag someone who is seated at a table or in a meeting', () => {
    const { s, rest, offender } = setup(30);
    offender.act = { kind: 'cake', seat: 'x', phase: 'gather' };
    run(s, 8);
    expect(rest.every((o) => o.shoo === 0)).toBe(true);
    expect(offender.shadowS).toBe(0);
  });
});

describe('forgetting the beam', () => {
  it('has kids pick a place in the beam more often than grown-ups, and everyone mostly avoiding it', () => {
    const rate = (age: number) => {
      const { s, w } = make(undefined, 4, 7);
      const wk = people(s)[0];
      wk.age = age;
      const pick = (s as unknown as { pickPersonTarget(w: Walker): [number, number] | null }).pickPersonTarget.bind(s);
      let inside = 0, n = 0;
      for (let i = 0; i < 4000; i++) { const p = pick(wk); if (!p) continue; n++; if (w.beamCells![Math.floor(p[1] / w.cell) * w.nx + Math.floor(p[0] / w.cell)]) inside++; }
      return inside / n;
    };
    const adult = rate(30), kid = rate(9);
    expect(kid).toBeGreaterThan(adult);
    // beam cells are a small share of the lot, so even forgetful picks land there rarely; with no film they are never excluded
    const share = (() => { const { w } = make(); return w.beamCells!.reduce((t, v) => t + v, 0) / w.reachable.length; })();
    expect(adult).toBeLessThan(share * 0.5 + 1e-9);
  });
});

describe('kids make shadow puppets', () => {
  it('a kid sometimes steps into the beam, near the wall, hands up, and the shadow gets wider; grown-ups do not', () => {
    const { s, sc } = make((c) => { c.movie.shadow.puppet.bias = 1; c.movie.shadow.reactS = [1, 1]; }, 15, 15);
    let kidPuppets = 0, adultPuppets = 0, maxCover = 0;
    const rect = { y0: sc.y - sc.width / 2, y1: sc.y + sc.width / 2, z0: sc.bottom, z1: sc.bottom + sc.height };
    run(s, 300, () => {
      for (const p of people(s)) {
        if (p.pose !== 'puppet') continue;
        if (ageGroup(p.age) === 'adult') adultPuppets++; else kidPuppets++;
        const want = Math.atan2(sc.y - p.y, sc.x - p.x);
        if (p.act?.kind === 'linger' && p.act.phase === 'do' && p.act.t > 2) expect(Math.abs(Math.atan2(Math.sin(p.heading - want), Math.cos(p.heading - want)))).toBeLessThan(0.5); // facing the screen
      }
      maxCover = Math.max(maxCover, coverage(s.screenShadows, rect));
    });
    expect(kidPuppets).toBeGreaterThan(0);
    expect(adultPuppets).toBe(0);
    expect(maxCover).toBeGreaterThan(0.02); // a kid is short, so the shadow is low on the screen
  });

  it('a puppeteer is waved at after four seconds like anyone else, and, being a kid, takes a while to give it up', () => {
    const { s } = make((c) => { c.movie.shadow.puppet.bias = 1; c.movie.shadow.kidReactS = [7, 7]; c.movie.shadow.puppet.sec = [100, 100]; }, 15, 15);
    let waved = false, left = -1, started = -1, who = -1;
    run(s, 200, (t) => {
      const ps = people(s);
      if (who < 0) { const k = ps.findIndex((p) => p.pose === 'puppet'); if (k >= 0) { who = s.walkers.indexOf(ps[k]); started = t; } }
      if (who >= 0) {
        if (ps.some((o) => o.shooAt === who && o.shoo > 0)) waved = true;
        if (left < 0 && s.walkers[who].act?.kind === 'dodge') left = t;
      }
    });
    expect(started).toBeGreaterThanOrEqual(0);
    expect(waved).toBe(true);
    expect(left).toBeGreaterThan(started + 4 + 6); // four seconds to be noticed, then seven to take the hint
  });
});
