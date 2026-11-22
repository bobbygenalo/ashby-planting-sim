import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { burstBrightness, FireworkShow, fireworksDay, fireworksOn, sparkOffset } from '../src/engine/fireworks';
import { buildLifeWorld, LifeSim } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';
import materialsRaw from '../src/data/materials.json';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life.fireworks;
const site = loadSite(siteRaw);
const structures = activeStructures(site, { aduEnabled: true });
const world = () => buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: materialsRaw as unknown as Material[], plants: [], month: 7, engine });

describe('fireworks on the Fourth of July', () => {
  it('are on July 4 from 8 pm to 11 pm only', () => {
    expect(fireworksDay(7, 4, cfg)).toBe(true);
    expect(fireworksDay(7, 5, cfg)).toBe(false);
    expect(fireworksOn(7, 4, 19 * 60 + 59, cfg)).toBe(false);
    expect(fireworksOn(7, 4, 20 * 60, cfg)).toBe(true);
    expect(fireworksOn(7, 4, 22 * 60 + 59, cfg)).toBe(true);
    expect(fireworksOn(7, 4, 23 * 60, cfg)).toBe(false);
    expect(fireworksOn(7, 3, 21 * 60, cfg)).toBe(false);
  });

  it('shows bursts beyond the back of the lot that fade out', () => {
    const show = new FireworkShow(site.lot, cfg, 3);
    let made = 0;
    for (let t = 0; t < 60; t += 0.1) {
      made += show.step(0.1).length;
      for (const b of show.bursts) {
        expect(b.pos[1]).toBeGreaterThan(site.lot.depth);
        expect(b.pos[2]).toBeGreaterThanOrEqual(cfg.heightFt[0]);
        expect(b.age).toBeLessThan(cfg.lifeS);
      }
    }
    expect(made).toBeGreaterThan(15);
    expect(show.bursts.length).toBeLessThan(10);
  });

  it('throws sparks out to the burst radius, drooping, and dims to nothing', () => {
    const b = { radius: 60, seed: 5 };
    const end = Array.from({ length: 40 }, (_, k) => sparkOffset(b, k, 40, cfg.lifeS, cfg));
    expect(Math.max(...end.map((o) => Math.hypot(o[0], o[1], o[2] + 0.5 * cfg.gravityFt * cfg.lifeS ** 2 * 0.25)))).toBeLessThanOrEqual(60 * 1.15 + 1e-6);
    expect(sparkOffset(b, 3, 40, 0, cfg).map(Math.abs)).toEqual([0, 0, 0]);
    expect(burstBrightness(0.01, cfg.lifeS)).toBeGreaterThan(0);
    expect(burstBrightness(cfg.lifeS, cfg.lifeS)).toBe(0);
    expect(burstBrightness(cfg.lifeS * 0.5, cfg.lifeS)).toBeLessThan(burstBrightness(cfg.lifeS * 0.1, cfg.lifeS));
  });
});

describe('people watch the fireworks', () => {
  const run = (sim: LifeSim, s: number) => { for (let i = 0; i < s * 10; i++) sim.step(0.1); };

  it('has open ground in the yard to watch from', () => {
    expect(world().skySpots.length).toBeGreaterThan(8);
  });

  it('brings most people outside, standing in the yard facing the sky, heads tipped up, and no film plays', () => {
    const sim = new LifeSim(world(), engine.life, 5, { people: 12, dogs: 2, bees: false });
    sim.setFireworksDay(true);
    sim.setClock(19 * 60);
    run(sim, 5);
    expect(sim.fireworksOn).toBe(false);
    sim.setClock(20 * 60 + 30);
    expect(sim.fireworksOn).toBe(true);
    expect(sim.movieOn).toBe(false);
    run(sim, 150);
    const people = sim.walkers.filter((w) => w.kind === 'person');
    const watching = people.filter((w) => w.act?.kind === 'watch' && w.act.sky && w.act.phase === 'watch');
    expect(watching.length).toBeGreaterThanOrEqual(8);
    for (const w of watching) {
      expect(w.lookUp).toBe(true);
      expect(Math.sin(w.heading)).toBeGreaterThan(0.95); // facing the rear
      expect(sim.world.skySpots.some((p) => Math.hypot(p[0] - w.x, p[1] - w.y) < 1.5)).toBe(true); // standing at one of the viewing places
    }
  });

  it('is gone by 11 pm: everyone goes in, and the next day has no show and the usual film', () => {
    const sim = new LifeSim(world(), engine.life, 6, { people: 8, dogs: 0, bees: false });
    sim.setFireworksDay(true);
    sim.setClock(20 * 60 + 30);
    run(sim, 60);
    sim.setClock(23 * 60 + 5);
    expect(sim.fireworksOn).toBe(false);
    sim.setFireworksDay(false);
    sim.setClock(20 * 60 + 30);
    expect(sim.fireworksOn).toBe(false);
    expect(sim.movieOn).toBe(true);
  });

  it('calls people indoors out to watch', () => {
    const sim = new LifeSim(world(), engine.life, 7, { people: 10, dogs: 0, bees: false });
    // Put everyone inside a building mid-afternoon.
    sim.setClock(15 * 60);
    const door = sim.world.doors[0];
    for (const w of sim.walkers) { w.visit = { door: door.id, phase: 'inside', left: 1e9 }; w.x = door.stand[0]; w.y = door.stand[1]; w.route = []; }
    sim.setFireworksDay(true);
    sim.setClock(20 * 60 + 1);
    run(sim, 200);
    const out = sim.walkers.filter((w) => !w.visit || w.visit.phase !== 'inside');
    expect(out.length).toBeGreaterThanOrEqual(6);
    expect(sim.walkers.filter((w) => w.act?.kind === 'watch' && w.act.sky).length).toBeGreaterThanOrEqual(5);
  });
});
