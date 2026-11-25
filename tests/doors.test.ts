import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { buildLifeWorld, isInside, LifeSim } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life;
const D = cfg.people.door;
const mats = materialsRaw as unknown as Material[];
const world = buildLifeWorld({ site, structures: activeStructures(site, { aduEnabled: true }), hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: [], month: 4, engine });

/** A day's run with many people, who go in and out of the doors, recording what the doors do. */
function run(seed: number, seconds: number) {
  const sim = new LifeSim(world, cfg, seed, { people: 12, dogs: 0, bees: false });
  const log = { passedShut: 0, steppedOutShut: 0, openedFor: new Map<string, number>(), maxOpen: new Map<string, number>(), staleOpen: 0, waiting: 0, waitingWithPose: 0, minWait: Infinity };
  const lastNeed = new Map<string, number>();
  const phase = new Map<number, string>();
  for (let t = 0; t < seconds; t += 0.1) {
    sim.step(0.1);
    for (const d of world.doors) {
      const open = sim.doorOpenness(d.id);
      log.maxOpen.set(d.id, Math.max(log.maxOpen.get(d.id) ?? 0, open));
      // anyone near the door going in or out (a broader reach than the sim's own, so a fully shut door is judged fairly)
      const near = sim.walkers.some((w) => w.visit?.door === d.id && (w.visit.phase === 'in' || w.visit.phase === 'out' || w.visit.opening) && Math.hypot(w.x - d.stand[0], w.y - d.stand[1]) < D.reachFt + 2);
      if (near) lastNeed.set(d.id, t);
      // once nobody has needed it for long enough to close, the door is shut
      if (t - (lastNeed.get(d.id) ?? -1e9) > D.closeDelayS + D.swingS + 1 && open > 0.001) log.staleOpen++;
    }
    sim.walkers.forEach((w, i) => {
      const v = w.visit;
      const door = v ? world.doors.find((x) => x.id === v.door) : undefined;
      if (v && door && v.phase === 'in') {
        const dist = Math.hypot(w.x - door.stand[0], w.y - door.stand[1]);
        // never closer than arm's length to a door that is not yet open
        if (dist < D.reachFt - 0.2 && sim.doorOpenness(door.id) < 0.9) log.passedShut++;
        if (dist < D.reachFt + 0.15 && sim.doorOpenness(door.id) < 0.9) { log.waiting++; if (w.pose === 'door') log.waitingWithPose++; }
      }
      const was = phase.get(i);
      if (v && was === 'inside' && v.phase === 'out' && door && sim.doorOpenness(door.id) < 0.9) log.steppedOutShut++;
      if (v && was === 'in' && v.phase === 'inside' && door) log.openedFor.set(door.id, (log.openedFor.get(door.id) ?? 0) + 1);
      phase.set(i, v?.phase ?? (isInside(w) ? 'inside' : 'free'));
    });
  }
  return log;
}

describe('doors are opened and closed by the people who use them', () => {
  const log = run(5, 1500);

  it('has a drawn door for every door people use', () => {
    const ids = new Set((site.openings ?? []).map((o) => o.id));
    for (const d of site.doors ?? []) expect(ids.has(d.opening!), `${d.id} has no drawn door`).toBe(true);
    expect(world.doors.every((d) => !!d.opening)).toBe(true);
  });

  it('opens each door that gets used, fully, and has it shut again afterwards', () => {
    for (const d of world.doors) {
      if ((log.openedFor.get(d.id) ?? 0) === 0) continue;
      expect(log.maxOpen.get(d.id)!, `${d.id} never opened`).toBeGreaterThan(0.97);
    }
    expect([...log.openedFor.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(8);
    expect(log.staleOpen, 'a door stayed open with nobody near').toBe(0);
  });

  it('never lets anyone walk through a shut door, going in or coming out', () => {
    expect(log.passedShut).toBe(0);
    expect(log.steppedOutShut).toBe(0);
  });

  it('has people stop at the door and reach for it while it opens', () => {
    expect(log.waiting).toBeGreaterThan(5);
    expect(log.waitingWithPose / log.waiting).toBeGreaterThan(0.9);
  });

  it('takes the time a door takes: it is not open the instant someone arrives', () => {
    const sim = new LifeSim(world, cfg, 3, { people: 1, dogs: 0, bees: false });
    const w = sim.walkers[0];
    const door = world.doors.find((d) => d.id === 'house-rear')!;
    w.x = door.approach[0]; w.y = door.approach[1]; w.route = []; w.act = null;
    w.visit = { door: door.id, phase: 'in', left: 0 };
    let firstNear = -1, opened = -1;
    for (let t = 0; t < 30; t += 0.05) {
      sim.step(0.05);
      const d = Math.hypot(w.x - door.stand[0], w.y - door.stand[1]);
      if (firstNear < 0 && d <= D.reachFt + 0.1) firstNear = t;
      if (opened < 0 && sim.doorOpenness(door.id) >= 0.97) opened = t;
    }
    expect(firstNear).toBeGreaterThan(0);
    expect(opened - firstNear).toBeGreaterThanOrEqual(D.swingS * 0.7); // it begins to open as they come up to it
    expect(opened - firstNear).toBeLessThan(D.swingS + 1.5);
  });
});
