import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { CritterSim } from '../src/engine/critters';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { buildLifeWorld, LifeSim } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';
import { defaultLifeSettings } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });
const placed = (list: [string, number, number][]): PlacedPlant[] =>
  list.map(([speciesId, x, y], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, 9 * 12, engine.growth) };
  });
// a yard with plenty to come for: flowers in November (salvia, rosemary, roses), a persimmon in fruit, shrubs to perch in
const YARD: [string, number, number][] = [['salvia-leucantha', 40, 100], ['rosmarinus-officinalis', 34, 96], ['rosa-iceberg', 30, 108], ['diospyros-kaki-hachiya', 38, 112], ['arctostaphylos-howard-mcminn', 44, 104], ['heteromeles-arbutifolia', 42, 90]];
const world = () => buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: placed(YARD), month: 11, engine });
const noon = { minutes: 12 * 60, night: false };
const shown = (c: CritterSim) => ({
  hummers: c.hummers.filter((h) => h.wanted).length, butterflies: c.butterflies.filter((b) => b.wanted).length, birds: c.birds.filter((b) => b.wanted).length, worms: c.worms.filter((w) => w.want > 0).length,
});

describe('how many of each creature to show', () => {
  it('shows what the yard calls for with no limit, none at zero, and never more than the limit', () => {
    const c = new CritterSim(world(), cfg.critters, 3);
    c.setClock(noon);
    const free = shown(c);
    expect(free.birds).toBeGreaterThan(2);
    expect(free.worms).toBeGreaterThan(2);
    c.setLimits({ birds: 0, worms: 0, hummingbirds: 0, butterflies: 0 });
    expect(shown(c)).toEqual({ hummers: 0, butterflies: 0, birds: 0, worms: 0 });
    c.setLimits({ birds: 2, worms: 3 });
    expect(shown(c).birds).toBeLessThanOrEqual(2);
    expect(shown(c).birds).toBe(Math.min(2, free.birds));
    expect(shown(c).worms).toBe(Math.min(3, free.worms));
    c.setLimits({ birds: Infinity, worms: Infinity, hummingbirds: Infinity, butterflies: Infinity });
    expect(shown(c)).toEqual(free);
  });

  it('can limit hummingbirds and butterflies in a yard that draws them', () => {
    const c = new CritterSim(world(), cfg.critters, 3);
    c.setClock(noon);
    const free = shown(c);
    c.setLimits({ hummingbirds: 1, butterflies: 1 });
    expect(shown(c).hummers).toBeLessThanOrEqual(1);
    expect(shown(c).butterflies).toBeLessThanOrEqual(1);
    expect(shown(c).hummers).toBe(Math.min(1, free.hummers));
  });
});

describe('how many bees', () => {
  const sim = (beeCount?: number) => new LifeSim(world(), cfg, 4, { people: 2, dogs: 0, bees: beeCount !== 0, beeCount });
  it('is all of them by default, or the number asked for, and none with none', () => {
    expect(sim().bees.length).toBe(cfg.bees.count);
    expect(sim(5).bees.length).toBe(5);
    expect(sim(0).bees.length).toBe(0);
    const s = sim();
    s.setCounts({ people: 2, dogs: 0, bees: true, beeCount: 9 });
    expect(s.bees.length).toBe(9);
  });
});

describe('the life settings', () => {
  it('start with everyone out, at each kind\'s top number, and the bees counted by what the config says', () => {
    const d = defaultLifeSettings(engine);
    expect(d).toEqual({ people: cfg.people.defaultCount, dogs: 2, birds: cfg.critters.birds.max, worms: cfg.critters.worms.max, bees: true, beeCount: cfg.bees.count, hummingbirds: cfg.critters.hummer.max, butterflies: cfg.critters.butterfly.max });
    expect(d.dogs).toBeLessThanOrEqual(cfg.dogs.max);
  });
});
