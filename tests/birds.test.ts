import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { birdPlan, CritterSim } from '../src/engine/critters';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { buildLifeWorld } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life.critters;
const bc = cfg.birds;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });
const placed = (list: [string, number, number, number?][]): PlacedPlant[] =>
  list.map(([speciesId, x, y, years = 9], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, years * 12, engine.growth) };
  });
const world = (plants: PlacedPlant[], month: number) =>
  buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants, month, engine });
const noon = { minutes: 12 * 60, night: false };
const ids = (w: ReturnType<typeof world>, d = noon) => birdPlan(w, d, bc, (sp) => sp.flock[1]).map((p) => p.id);

// a yard with shrubs to perch in and soil to scratch, fruit on the persimmon in the fall, toyon berries in winter, and hummingbird flowers
const SHRUBS: [string, number, number, number?][] = [['arctostaphylos-howard-mcminn', 34, 100], ['salvia-clevelandii', 40, 96], ['penstemon-margarita-bop', 30, 108]];
const FRUIT: [string, number, number, number?][] = [['diospyros-kaki-hachiya', 38, 112]];
const TOYON: [string, number, number, number?][] = [['heteromeles-arbutifolia', 42, 104]];

describe('native birds, season by season', () => {
  it('lists ten species with the months they are here, resident all year, winter visitors and summer visitors', () => {
    expect(bc.species).toHaveLength(10);
    const by = (id: string) => bc.species.find((s) => s.id === id)!;
    expect(by('california-towhee').months).toHaveLength(12);
    expect(by('bushtit').months).toHaveLength(12);
    expect(by('cedar-waxwing').months).toEqual([11, 12, 1, 2, 3, 4]);
    expect(by('white-crowned-sparrow').months).toEqual([10, 11, 12, 1, 2, 3, 4]);
    expect(by('black-headed-grosbeak').months).toEqual([4, 5, 6, 7, 8]);
    expect(by('hooded-oriole').months).toEqual([4, 5, 6, 7, 8]);
    for (const s of bc.species) {
      expect(['ground', 'canopy', 'fruit', 'nectar']).toContain(s.guild);
      expect(s.flock[0]).toBeGreaterThanOrEqual(1);
      expect(s.flock[1]).toBeGreaterThanOrEqual(s.flock[0]);
      expect(s.sizeFt).toBeGreaterThan(0.2);
      expect(s.note.length).toBeGreaterThan(10);
    }
  });

  it('bring the winter visitors only in winter and the summer visitors only in summer, and the residents always', () => {
    const plants = placed([...SHRUBS, ...TOYON, ...FRUIT]);
    const jan = ids(world(plants, 1)), jun = ids(world(plants, 6)), oct = ids(world(plants, 10));
    expect(jan).toContain('white-crowned-sparrow');
    expect(jan).toContain('yellow-rumped-warbler');
    expect(jan).toContain('cedar-waxwing'); // with the toyon in berry
    expect(jan).not.toContain('black-headed-grosbeak');
    expect(jun).toContain('black-headed-grosbeak');
    expect(jun).not.toContain('white-crowned-sparrow');
    expect(jun).not.toContain('cedar-waxwing');
    expect(jun).not.toContain('yellow-rumped-warbler');
    for (const m of [oct, jan, jun]) {
      expect(m).toContain('california-towhee');
      expect(m).toContain('bushtit');
    }
    expect(oct).toContain('white-crowned-sparrow'); // October already
    expect(ids(world(plants, 9))).not.toContain('white-crowned-sparrow');
    expect(ids(world(plants, 5))).not.toContain('cedar-waxwing');
  });

  it('come only in the daylight hours, and not at night', () => {
    const w = world(placed([...SHRUBS, ...FRUIT]), 10);
    expect(ids(w, { minutes: 5 * 60, night: false })).toEqual([]);
    expect(ids(w, { minutes: 19 * 60, night: false })).toEqual([]);
    expect(ids(w, { minutes: 12 * 60, night: true })).toEqual([]);
    expect(ids(w, { minutes: 7 * 60, night: false }).length).toBeGreaterThan(0);
    expect(ids(w, { minutes: 18 * 60, night: false }).length).toBeGreaterThan(0);
  });

  it('come for what the plants offer: fruit eaters need ripe fruit or berries, the nectar sipper needs flowers, the others need somewhere to perch', () => {
    const none = world([], 11);
    expect(ids(none)).toEqual([]); // nothing to perch in or eat
    const shrubsOnly = ids(world(placed(SHRUBS), 11));
    expect(shrubsOnly).toContain('bushtit');
    expect(shrubsOnly).not.toContain('cedar-waxwing'); // no fruit
    expect(shrubsOnly).not.toContain('california-scrub-jay');
    expect(shrubsOnly).not.toContain('northern-mockingbird');
    const withFruit = ids(world(placed([...SHRUBS, ...FRUIT]), 11));
    expect(withFruit).toContain('cedar-waxwing');
    expect(withFruit).toContain('california-scrub-jay');
    expect(withFruit).toContain('northern-mockingbird');
    // the persimmon is ripe in the fall but not in the spring
    expect(world(placed(FRUIT), 11).birdFood).toHaveLength(1);
    expect(world(placed(FRUIT), 5).birdFood).toHaveLength(0);
    // a young tree bears nothing yet
    expect(world(placed([['diospyros-kaki-hachiya', 38, 112, 1]]), 11).birdFood).toHaveLength(0);
    // toyon berries are a winter food
    expect(world(placed(TOYON), 1).birdFood).toHaveLength(1);
    expect(world(placed(TOYON), 7).birdFood).toHaveLength(0);
    // the oriole sips nectar: only with hummingbird flowers open, and only in summer
    const flowers = placed([['penstemon-margarita-bop', 34, 100], ['arctostaphylos-howard-mcminn', 40, 100]]);
    expect(ids(world(flowers, 6))).toContain('hooded-oriole');
    expect(ids(world(flowers, 12))).not.toContain('hooded-oriole'); // winter
    expect(ids(world(placed([['lomandra-longifolia', 34, 100], ['arctostaphylos-howard-mcminn', 40, 100]]), 6))).not.toContain('hooded-oriole'); // nothing in bloom for it
  });

  it('never put more birds in the yard than the most it shows, and keep flocks within their sizes', () => {
    const plants = placed([...SHRUBS, ...FRUIT, ...TOYON]);
    for (let m = 1; m <= 12; m++) {
      const plan = birdPlan(world(plants, m), noon, bc, (sp) => sp.flock[1]);
      expect(plan.reduce((a, p) => a + p.count, 0)).toBeLessThanOrEqual(bc.max);
      for (const p of plan) {
        const sp = bc.species.find((s) => s.id === p.id)!;
        expect(p.count).toBeLessThanOrEqual(sp.flock[1]);
        expect(p.count).toBeGreaterThanOrEqual(1);
      }
    }
    // a bigger flock is asked for, a bigger flock comes, up to the species' most
    const small = birdPlan(world(plants, 7), noon, bc, (sp) => sp.flock[0]);
    const big = birdPlan(world(plants, 7), noon, bc, (sp) => sp.flock[1]);
    expect(big.reduce((a, p) => a + p.count, 0)).toBeGreaterThanOrEqual(small.reduce((a, p) => a + p.count, 0));
  });
});

describe('the birds in the yard', () => {
  const run = (sim: CritterSim, seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 0.1) { sim.step(0.1); each?.(); } };

  it('arrive in the daytime, play the species the season allows, and fade out at dusk', () => {
    const w = world(placed([...SHRUBS, ...FRUIT, ...TOYON]), 1);
    const sim = new CritterSim(w, cfg, 4);
    sim.setClock(noon);
    run(sim, 4);
    const here = sim.birds.filter((b) => b.vis > 0.99 && b.species);
    expect(here.length).toBeGreaterThan(3);
    const winterOnly = new Set(['cedar-waxwing', 'white-crowned-sparrow', 'yellow-rumped-warbler']);
    expect(here.some((b) => winterOnly.has(b.species!))).toBe(true);
    expect(here.every((b) => b.species !== 'black-headed-grosbeak' && b.species !== 'hooded-oriole')).toBe(true); // summer visitors are away
    sim.setClock({ minutes: 19 * 60, night: false });
    run(sim, bc.fadeS + 1);
    expect(sim.birds.every((b) => b.vis === 0)).toBe(true);
  });

  it('feed where they should: ground birds on the ground, fruit birds at the fruiting plants', () => {
    const w = world(placed([...SHRUBS, ...FRUIT, ...TOYON]), 12);
    const sim = new CritterSim(w, cfg, 8);
    sim.setClock(noon);
    let groundSeen = 0, fruitSeen = 0;
    run(sim, 150, () => {
      for (const b of sim.birds) {
        if (!b.species || b.vis < 0.5 || b.state !== 'forage') continue;
        const sp = bc.species.find((s) => s.id === b.species)!;
        if (sp.guild === 'ground') {
          groundSeen++;
          expect(b.z).toBeLessThan(0.4);
        }
        if (sp.guild === 'fruit') {
          fruitSeen++;
          expect(w.birdFood.some((f) => Math.hypot(f.x - b.x, f.y - b.y) <= f.radius + 3.2), `${b.species} away from fruit`).toBe(true);
        }
      }
    });
    expect(groundSeen).toBeGreaterThan(20);
    expect(fruitSeen).toBeGreaterThan(20);
  });

  it('keep a flock together, near its leader', () => {
    const w = world(placed([...SHRUBS, ...TOYON, ...FRUIT]), 12);
    const sim = new CritterSim(w, cfg, 2);
    sim.setClock(noon);
    run(sim, 60);
    const flock = sim.birds.filter((b) => b.species === 'bushtit' && b.vis > 0.9);
    expect(flock.length).toBeGreaterThanOrEqual(bc.species.find((s) => s.id === 'bushtit')!.flock[0]);
    const lead = sim.birds[flock[0].leader];
    for (const b of flock) expect(b.leader).toBe(flock[0].leader);
    // once settled, perched members are within a few feet of the leader's perch most of the time
    let near = 0, count = 0;
    run(sim, 60, () => { for (const b of flock) if (b.state === 'perch' && lead.state === 'perch') { count++; if (Math.hypot(b.x - lead.x, b.y - lead.y) < 8) near++; } });
    expect(count).toBeGreaterThan(10);
    expect(near / count).toBeGreaterThan(0.5);
  });

  it('are repeatable for a seed and stay in and near the lot', () => {
    const w = world(placed([...SHRUBS, ...FRUIT]), 11);
    const go = (seed: number) => {
      const sim = new CritterSim(w, cfg, seed);
      sim.setClock(noon);
      run(sim, 40);
      return JSON.stringify(sim.birds);
    };
    expect(go(3)).toBe(go(3));
    expect(go(3)).not.toBe(go(4));
    const sim = new CritterSim(w, cfg, 6);
    sim.setClock(noon);
    run(sim, 120, () => { for (const b of sim.birds) { expect(b.x).toBeGreaterThan(-4); expect(b.x).toBeLessThan(site.lot.width + 4); expect(b.y).toBeGreaterThan(-4); expect(b.y).toBeLessThan(site.lot.depth + 4); expect(b.z).toBeGreaterThanOrEqual(0); } });
  });
});
