import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { buildLifeWorld, chooseHiveSpot, findRoute, hiveSpotIsGood, LifeSim, type LifeWorld, type LifeWorldInput } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SiteConfig, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });

const placed = (list: [string, number, number, number?][]): PlacedPlant[] =>
  list.map(([speciesId, x, y, years = 8], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, years * 12, engine.growth) };
  });
const el = (type: HardscapeElement['type'], points: [number, number][], materialId: string, id = type): HardscapeElement => ({
  id, type, points, materialId, height: type === 'raisedBed' ? 1.5 : 0, depthIn: 3, width: type === 'path' ? 3 : 0, existing: false,
});

const FULL_PLANTS = placed([
  ['salvia-bees-bliss', 36, 100], ['ceanothus-concha', 42, 108], ['salvia-clevelandii', 30, 112], ['arctostaphylos-howard-mcminn', 38, 92],
  ['lomandra-longifolia', 45, 100], ['salvia-leucantha', 33, 106],
]);
const HARDSCAPE: HardscapeElement[] = [
  ...(site.hardscape as HardscapeElement[]),
  el('lawn', [[24, 85], [34, 85], [34, 95], [24, 95]], 'lawn'),
  el('path', [[24, 100], [30, 104], [36, 120], [44, 121]], 'decomposed-granite'),
  el('bed', [[40, 85], [47, 85], [47, 90], [40, 90]], 'soil-bed'),
  el('raisedBed', [[24, 126], [28, 126], [28, 134], [24, 134]], 'raised-bed-wood'),
  el('gravel', [[26, 70], [34, 70], [34, 76], [26, 76]], 'mulch'),
];
const input = (over: Partial<LifeWorldInput> = {}): LifeWorldInput => ({
  site, structures, hardscape: HARDSCAPE, materials: mats, plants: FULL_PLANTS, month: 4, engine, ...over,
});
const world = () => buildLifeWorld(input());
const cellBlocked = (w: LifeWorld, x: number, y: number) => w.blocked[Math.min(w.ny - 1, Math.floor(y / w.cell)) * w.nx + Math.min(w.nx - 1, Math.floor(x / w.cell))] === 1;

describe('the walking world', () => {
  const w = world();

  it('blocks buildings, plant canopies, raised beds and the lot edge, and nothing it should leave open', () => {
    expect(cellBlocked(w, 10, 95)).toBe(true); // the garage
    expect(cellBlocked(w, 30, 130)).toBe(true); // the ADU
    expect(cellBlocked(w, 26, 130)).toBe(true); // a raised bed
    expect(cellBlocked(w, 0.4, 50)).toBe(true); // the lot edge
    for (const p of w.plants) expect(cellBlocked(w, p.x, p.y)).toBe(true);
    expect(cellBlocked(w, 30, 98)).toBe(false); // open ground
    expect(cellBlocked(w, 29, 90)).toBe(false); // lawn
    expect(w.reachable.length).toBeGreaterThan(1000);
    expect(w.reachable.every((k) => w.blocked[k] === 0)).toBe(true);
  });

  it('keeps clear of every canopy by more than half a cell, so nobody can stand in one', () => {
    expect(cfg.margins.plantFt).toBeGreaterThan((cfg.cellFt * Math.SQRT2) / 2);
    for (const k of w.reachable) {
      const x = ((k % w.nx) + 0.5) * w.cell, y = (Math.floor(k / w.nx) + 0.5) * w.cell;
      for (const p of w.plants) expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThan(p.r);
      for (const s of w.structures) expect(pointInPolygon(x, y, s)).toBe(false);
    }
  });

  it('makes paths the cheapest ground and beds the dearest, with open ground between', () => {
    const at = (x: number, y: number) => w.cost[Math.floor(y / w.cell) * w.nx + Math.floor(x / w.cell)];
    expect(w.pathCells.length).toBeGreaterThan(20);
    const pathCost = Math.min(...w.pathCells.map((k) => w.cost[k]));
    expect(pathCost).toBeCloseTo(cfg.costs.path, 6);
    expect(at(43, 87)).toBeGreaterThanOrEqual(cfg.costs.bed); // a planting bed
    expect(at(30, 73)).toBeGreaterThanOrEqual(cfg.costs.mulch); // mulch
    expect(at(29, 90)).toBeLessThan(cfg.costs.bed);
  });

  it('ignores an element a scenario removes, and a plant that is not yet planted blocks nothing', () => {
    const gone = buildLifeWorld(input({ hardscape: HARDSCAPE.map((h) => (h.type === 'raisedBed' ? { ...h, removed: true } : h)), structures: [] }));
    expect(cellBlocked(gone, 26, 130)).toBe(false); // the raised bed was the only thing there
    expect(cellBlocked(buildLifeWorld(input({ structures: [] })), 26, 130)).toBe(true);
    const unplanted = placed([['ceanothus-concha', 40, 98]]).map((p) => ({ ...p, size: { planted: false, height: 0, width: 0 } }));
    expect(buildLifeWorld(input({ plants: unplanted })).plants).toEqual([]);
  });
});

describe('finding a way', () => {
  const field: SiteConfig = { ...site, lot: { width: 44, depth: 24 }, zones: site.zones, easements: [], contextObjects: [] };
  const open = (hardscape: HardscapeElement[], plants: PlacedPlant[] = []) =>
    buildLifeWorld({ site: field, structures: [], hardscape, materials: mats, plants, month: 4, engine });

  it('goes around a plant and never through it', () => {
    const w = open([], placed([['ceanothus-concha', 22, 12]]));
    const route = findRoute(w, [4, 12], [40, 12])!;
    expect(route).toBeTruthy();
    for (const [x, y] of route) expect(cellBlocked(w, x, y)).toBe(false);
    expect(Math.max(...route.map((p) => Math.abs(p[1] - 12)))).toBeGreaterThan(3); // swung wide around the canopy
  });

  it('prefers a path when it costs less than going straight', () => {
    const w = open([el('path', [[5, 8], [39, 8]], 'decomposed-granite')]);
    const route = findRoute(w, [5, 15], [39, 15])!;
    const onPath = route.filter(([x, y]) => w.isPath[Math.floor(y / w.cell) * w.nx + Math.floor(x / w.cell)] === 1).length;
    expect(onPath).toBeGreaterThan(route.length * 0.5);
    // but a short hop across open ground beats a long detour to the path
    const near = findRoute(w, [5, 14], [9, 14])!;
    expect(near.every(([, y]) => Math.abs(y - 14) < 1.5)).toBe(true);
  });

  it('says so when there is no way', () => {
    const wall = open([el('raisedBed', [[0, 11], [44, 11], [44, 13], [0, 13]], 'raised-bed-wood')]);
    expect(findRoute(wall, [10, 3], [10, 20])).toBeNull();
    expect(findRoute(wall, [10, 12], [10, 20])).toBeNull(); // starting inside something
  });
});

describe('people and dogs', () => {
  const w = world();
  const run = (seed: number, seconds: number, people = 4, dogs = 2, dt = 0.1) => {
    const sim = new LifeSim(w, cfg, seed, { people, dogs, bees: true });
    const samples: { kind: string; x: number; y: number }[] = [];
    for (let t = 0; t < seconds; t += dt) {
      sim.step(dt);
      for (const a of sim.walkers) samples.push({ kind: a.kind, x: a.x, y: a.y });
    }
    return { sim, samples };
  };

  it('never stands in a plant, a building, a raised bed or outside the lot, however long they walk', () => {
    for (const seed of [1, 2, 3]) {
      const { samples } = run(seed, 400);
      for (const a of samples) {
        expect(cellBlocked(w, a.x, a.y), `${a.kind} at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`).toBe(false);
        for (const p of w.plants) expect(Math.hypot(p.x - a.x, p.y - a.y), 'inside a canopy').toBeGreaterThan(p.r);
        for (const s of w.structures) expect(pointInPolygon(a.x, a.y, s)).toBe(false);
        expect(a.x).toBeGreaterThan(0);
        expect(a.y).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(site.lot.width);
        expect(a.y).toBeLessThan(site.lot.depth);
      }
    }
  });

  it('even survives a long frame without jumping through anything', () => {
    const sim = new LifeSim(w, cfg, 5, { people: 3, dogs: 2, bees: false });
    for (let n = 0; n < 200; n++) {
      sim.step(4); // a four-second hitch
      for (const a of sim.walkers) expect(cellBlocked(w, a.x, a.y)).toBe(false);
    }
  });

  it('gravitates toward paths without being stuck on them', () => {
    const { samples } = run(11, 900, 4, 0);
    const near = (x: number, y: number, d: number) => w.pathCells.some((k) => Math.hypot(((k % w.nx) + 0.5) * w.cell - x, (Math.floor(k / w.nx) + 0.5) * w.cell - y) < d);
    const share = samples.filter((a) => near(a.x, a.y, 2.5)).length / samples.length;
    const open = w.reachable.filter((k) => near(((k % w.nx) + 0.5) * w.cell, (Math.floor(k / w.nx) + 0.5) * w.cell, 2.5)).length / w.reachable.length;
    expect(share).toBeGreaterThan(open * 2); // far more time by the path than its share of the ground
    expect(share).toBeLessThan(0.9); // but they roam
    const far = samples.filter((a) => !near(a.x, a.y, 6)).length / samples.length;
    expect(far).toBeGreaterThan(0.1); // clearly off the paths for a good part of the time
  });

  it('covers a good part of the yard, not one corner', () => {
    const { samples } = run(4, 900, 3, 0);
    const cells = new Set(samples.map((a) => `${Math.floor(a.x / 6)},${Math.floor(a.y / 6)}`));
    expect(cells.size).toBeGreaterThan(25);
  });

  it('allows at most two dogs and four people, however many are asked for', () => {
    const sim = new LifeSim(w, cfg, 1, { people: 99, dogs: 99, bees: false });
    expect(sim.walkers.filter((a) => a.kind === 'dog')).toHaveLength(2);
    expect(sim.walkers.filter((a) => a.kind === 'person')).toHaveLength(4);
    const none = new LifeSim(w, cfg, 1, { people: 0, dogs: 0, bees: false });
    expect(none.walkers).toHaveLength(0);
    const neg = new LifeSim(w, cfg, 1, { people: -3, dogs: -1, bees: false });
    expect(neg.walkers).toHaveLength(0);
    sim.setCounts({ people: 1, dogs: 1, bees: false });
    expect(sim.walkers.map((a) => a.kind).sort()).toEqual(['dog', 'person']);
  });

  it('has dogs stay near their person', () => {
    const sim = new LifeSim(w, cfg, 8, { people: 1, dogs: 2, bees: false });
    let near = 0, total = 0;
    for (let t = 0; t < 600; t += 0.1) {
      sim.step(0.1);
      if (t < 30) continue;
      const person = sim.walkers.find((a) => a.kind === 'person')!;
      for (const d of sim.walkers.filter((a) => a.kind === 'dog')) {
        total++;
        if (Math.hypot(d.x - person.x, d.y - person.y) < 25) near++;
      }
    }
    expect(near / total).toBeGreaterThan(0.7);
  });

  it('is the same every time for the same seed, and moves when asked to wait', () => {
    const a = run(21, 60), b = run(21, 60);
    expect(b.samples).toEqual(a.samples);
    expect(JSON.stringify(run(22, 60).samples)).not.toBe(JSON.stringify(a.samples));
    const sim = new LifeSim(w, cfg, 3, { people: 2, dogs: 0, bees: false });
    const before = sim.walkers.map((q) => [q.x, q.y]);
    sim.step(0);
    expect(sim.walkers.map((q) => [q.x, q.y])).toEqual(before);
  });

  it('moves anyone out of the way when a plant grows over them, and keeps going', () => {
    const sim = new LifeSim(w, cfg, 2, { people: 2, dogs: 1, bees: false });
    const victim = sim.walkers[0];
    const grown = buildLifeWorld(input({ plants: [...FULL_PLANTS, ...placed([['heteromeles-arbutifolia', victim.x, victim.y, 20]])] }));
    sim.setWorld(grown);
    for (const a of sim.walkers) expect(cellBlocked(grown, a.x, a.y)).toBe(false);
    for (let n = 0; n < 300; n++) sim.step(0.1);
    for (const a of sim.walkers) expect(cellBlocked(grown, a.x, a.y)).toBe(false);
  });
});

describe('the hive and the bees', () => {
  const w = world();

  it('puts the hive well away from paths and buildings, clear of plants, inside the lot', () => {
    expect(w.hive).toBeTruthy();
    expect(hiveSpotIsGood(w, w.hive!, cfg)).toBe(true);
    for (const s of w.structures) expect(distanceToPolygon(w.hive!.x, w.hive!.y, s)).toBeGreaterThanOrEqual(cfg.bees.hive.minFromStructureFt);
    for (const k of w.pathCells) {
      const x = ((k % w.nx) + 0.5) * w.cell, y = (Math.floor(k / w.nx) + 0.5) * w.cell;
      expect(Math.hypot(x - w.hive!.x, y - w.hive!.y)).toBeGreaterThanOrEqual(cfg.bees.hive.minFromPathFt - 1e-9);
    }
    for (const p of w.plants) expect(Math.hypot(p.x - w.hive!.x, p.y - w.hive!.y)).toBeGreaterThan(p.r + cfg.bees.hive.minFromPlantFt - 1e-9);
  });

  it('keeps people and dogs well away from the hive', () => {
    const sim = new LifeSim(w, cfg, 6, { people: 4, dogs: 2, bees: true });
    for (let t = 0; t < 600; t += 0.1) {
      sim.step(0.1);
      for (const a of sim.walkers) expect(Math.hypot(a.x - w.hive!.x, a.y - w.hive!.y)).toBeGreaterThanOrEqual(cfg.margins.hiveFt - cfg.cellFt);
    }
  });

  it('keeps the hive where it is while it is still a good spot, and moves it when it is not', () => {
    const again = buildLifeWorld(input({ hive: w.hive }));
    expect(again.hive).toEqual(w.hive);
    const covered = buildLifeWorld(input({ hive: w.hive, plants: [...FULL_PLANTS, ...placed([['heteromeles-arbutifolia', w.hive!.x + 1, w.hive!.y, 20]])] }));
    expect(covered.hive).not.toEqual(w.hive);
    expect(covered.hive).toBeTruthy();
    expect(chooseHiveSpot(w, cfg, () => 0.5)).toBeTruthy();
  });

  it('sends the bees out to flowers in bloom, lets them feed, and brings them home', () => {
    const sim = new LifeSim(w, cfg, 4, { people: 0, dogs: 0, bees: true });
    expect(sim.bees).toHaveLength(cfg.bees.count);
    expect(sim.bees.every((b) => b.x === w.hive!.x && b.y === w.hive!.y)).toBe(true);
    const blooming = w.blooms;
    expect(blooming.length).toBeGreaterThan(0);
    const phases = new Set<string>();
    let fed = 0, home = 0;
    for (let t = 0; t < 240; t += 0.1) {
      sim.step(0.1);
      for (const b of sim.bees) {
        phases.add(b.phase);
        expect(Number.isFinite(b.x + b.y + b.z)).toBe(true);
        expect(b.z).toBeGreaterThanOrEqual(0.5);
        if (b.phase === 'forage') {
          const f = blooming.find((q) => Math.hypot(q.x - b.x, q.y - b.y) <= q.radius + 0.01);
          expect(f, 'a bee is feeding where nothing is in bloom').toBeTruthy();
          fed++;
        }
        if (b.phase === 'rest' && Math.hypot(b.x - w.hive!.x, b.y - w.hive!.y) < 0.01) home++;
      }
    }
    expect([...phases].sort()).toEqual(['back', 'forage', 'out', 'rest']);
    expect(fed).toBeGreaterThan(200);
    expect(home).toBeGreaterThan(200);
  });

  it('keeps the bees near the hive when nothing is in bloom, and has none without a hive or when switched off', () => {
    const none = buildLifeWorld(input({ month: 8 }));
    const sim = new LifeSim(none, cfg, 4, { people: 0, dogs: 0, bees: true });
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      for (const b of sim.bees) expect(Math.hypot(b.x - none.hive!.x, b.y - none.hive!.y)).toBeLessThan(cfg.bees.wanderFt + 6);
    }
    expect(new LifeSim(w, cfg, 4, { people: 1, dogs: 0, bees: false }).bees).toHaveLength(0);
    const blockedHive = { ...w, hive: null } as LifeWorld;
    expect(new LifeSim(blockedHive, cfg, 4, { people: 1, dogs: 0, bees: true }).bees).toHaveLength(0);
  });
});

describe('where the hive goes', () => {
  it('prefers the back of the lot over the front', () => {
    const w = world();
    const hives = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      let n = seed;
      return chooseHiveSpot(w, cfg, () => ((n = (n * 1664525 + 1013904223) % 4294967296) / 4294967296))!;
    });
    expect(hives.filter((h) => h.y > site.lot.depth / 2).length).toBeGreaterThanOrEqual(6);
    for (const h of hives) expect(hiveSpotIsGood(w, h, cfg)).toBe(true);
  });
});
