import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { placedPlants } from '../src/engine/growth';
import { costReadout, emptyPrices, projectCost, waterCost } from '../src/engine/pricing';
import { emptyScenarioData } from '../src/engine/scenario';
import { loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const materials = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const site = loadSite(siteRaw);

const inst = (id: string, speciesId: string, x: number, y: number): PlantInstance => ({ id, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false });
const patio = (id: string): HardscapeElement => ({ id, type: 'patio', points: [[10, 70], [20, 70], [20, 80], [10, 80]], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false });

function readout(instances: PlantInstance[], extra: HardscapeElement[], opts: { irrigationSystemCost?: number; waterGallonsPerYear?: number } = {}) {
  const base = emptyScenarioData(site);
  const plants = placedPlants(instances, base.palette, lib.species, 120, engine.growth);
  const elements = [...base.hardscape, ...extra];
  return { plants, elements, r: costReadout({ plants, elements, materials, engine, prices: emptyPrices(), irrigationSystemCost: opts.irrigationSystemCost ?? 0, waterGallonsPerYear: opts.waterGallonsPerYear ?? 0 }) };
}

describe('water cost', () => {
  it('prices a gallon from the rate per hundred cubic feet', () => {
    expect(waterCost(748, engine.pricing)).toBeCloseTo(engine.pricing.water.perCcf, 6);
    expect(waterCost(0, engine.pricing)).toBe(0);
    expect(waterCost(7480, engine.pricing)).toBeCloseTo(engine.pricing.water.perCcf * 10, 6);
  });

  it('is flagged as a stand-in with a source and a reference', () => {
    expect(engine.pricing.water.status).toBe('stand-in');
    expect(engine.pricing.water.reference.url).toMatch(/^https:\/\//);
    expect(engine.pricing.water.source.length).toBeGreaterThan(40);
  });
});

describe('scenario cost readout', () => {
  it('splits hardscape and planting the way projectCost does', () => {
    const { plants, elements, r } = readout([inst('a', 'coleonema-pulchellum', 30, 76), inst('b', 'salvia-leucantha', 38, 76)], [patio('p1')]);
    const p = projectCost(plants, elements, materials, engine, emptyPrices());
    expect(r.hardscape).toBeCloseTo(p.hardscape, 6);
    expect(r.planting).toBeCloseTo(p.plants, 6);
    expect(r.hardscape).toBeGreaterThan(0);
    expect(r.planting).toBeGreaterThan(0);
  });

  it('adds the irrigation system to the up-front total and the first year of water on top', () => {
    const { r } = readout([inst('a', 'coleonema-pulchellum', 30, 76)], [patio('p1')], { irrigationSystemCost: 500, waterGallonsPerYear: 7480 });
    expect(r.upFront).toBeCloseTo(r.hardscape + r.planting + 500, 6);
    expect(r.waterPerYear).toBeCloseTo(engine.pricing.water.perCcf * 10, 6);
    expect(r.firstYear).toBeCloseTo(r.upFront + r.waterPerYear, 6);
  });

  it('moves with the scenario: more plants and more paving cost more, and nothing costs nothing', () => {
    const none = readout([], []).r;
    const some = readout([inst('a', 'coleonema-pulchellum', 30, 76)], [patio('p1')]).r;
    const more = readout([inst('a', 'coleonema-pulchellum', 30, 76), inst('b', 'coleonema-pulchellum', 34, 76)], [patio('p1'), patio('p2')]).r;
    expect(none.hardscape).toBe(0);
    expect(none.planting).toBe(0);
    expect(some.upFront).toBeGreaterThan(none.upFront);
    expect(more.upFront).toBeGreaterThan(some.upFront);
  });
});
