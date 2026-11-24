import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { buildLifeWorld, LifeSim } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });
const placed = (list: [string, number, number][]): PlacedPlant[] =>
  list.map(([speciesId, x, y], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, 144, engine.growth) };
  });

// Orchards in November, from roomy to cramped, with everyone eager to pick and the yard full of people.
const ORCHARDS: Record<string, [string, number, number][]> = {
  roomy: [['malus-mutsu', 34, 100], ['citrus-kumquat', 40, 96], ['citrus-meyer-lemon', 30, 108]],
  single: [['malus-mutsu', 34, 100]],
  cramped: [['malus-mutsu', 34, 100], ['citrus-meyer-lemon', 38, 101], ['citrus-kumquat', 36, 105], ['malus-mutsu', 30, 104]],
};

describe('harvesting never leaves anyone stuck', () => {
  for (const [name, list] of Object.entries(ORCHARDS)) {
    it(`keeps every picker moving in the ${name} orchard: no stall of more than 20 seconds, and plenty of baskets taken in`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
        cfg.harvest.bias = 1; cfg.dining.bias = 0; cfg.people.visitBias = 0.1; cfg.people.meet.bias = 0.1;
        const w = buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: placed(list), month: 11, engine: { ...engine, life: cfg } });
        const s = new LifeSim(w, cfg, seed, { people: 12, dogs: 2, bees: false });
        const sig = new Map<number, string>(), since = new Map<number, number>(), pickers = new Set<number>();
        let worst = 0, trips = 0;
        for (let t = 0; t < 600; t += 0.1) {
          s.step(0.1);
          s.walkers.forEach((wk, i) => {
            if (wk.kind !== 'person') return;
            const act = wk.act;
            const busy = act?.kind === 'harvest' || (wk.basket && wk.visit && wk.visit.phase !== 'inside');
            if (act?.kind === 'harvest') pickers.add(i);
            if (!busy) {
              if (pickers.has(i) && wk.basket === null) { trips++; pickers.delete(i); }
              since.delete(i); sig.delete(i);
              return;
            }
            // "stuck" is nothing at all changing: not where they stand, what they are doing, how far through a pick, or what is in the basket
            const key = `${act?.kind === 'harvest' ? act.phase + act.plant + (act.cycle ? Math.floor(wk.pickU * 10) : -1) : ''}|${wk.basket?.items.length}|${Math.round(wk.x * 2)}|${Math.round(wk.y * 2)}|${wk.visit?.phase}`;
            if (sig.get(i) !== key) { sig.set(i, key); since.set(i, t); }
            worst = Math.max(worst, t - (since.get(i) ?? t));
          });
        }
        expect(worst, `${name} seed ${seed}`).toBeLessThan(20);
        expect(trips, `${name} seed ${seed}`).toBeGreaterThan(8);
      }
    });
  }

  it('gives up an errand after being held up for the set time, rather than waiting for ever', () => {
    const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
    cfg.harvest.bias = 0; cfg.people.meet.bias = 0; cfg.dining.bias = 0; cfg.people.visitBias = 0;
    const w = buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants: [], month: 5, engine: { ...engine, life: cfg } });
    const s = new LifeSim(w, cfg, 2, { people: 2, dogs: 0, bees: false });
    const a = s.walkers[0];
    a.basket = { volume: 0.3, used: 0, items: [] };
    a.heldTotal = cfg.people.giveUpS - 0.05;
    (s as unknown as { heldUp(w: unknown, dt: number): void }).heldUp(a, 0.1);
    expect(a.heldTotal).toBe(0);
    expect(a.basket).toBeNull(); // the basket is put down with the errand
    expect(a.route).toEqual([]);
  });
});
