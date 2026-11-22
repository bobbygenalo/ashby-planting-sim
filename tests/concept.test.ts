import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { generateConcept } from '../src/engine/concept';
import { distanceToPolygon, pointInPolygon, polygonsIntersect } from '../src/engine/geometry';
import { footprint } from '../src/engine/hardscape';
import { emptyScenarioData } from '../src/engine/scenario';
import { lookAlikes, mulberry32, shuffleScenario } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, Material, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const owner = emptyScenarioData(site);
const ctx = { site, structures, species: lib.species, materials: mats, engine, palette: owner.palette };
const BOTH = { hardscape: true, plants: true, starredOnly: true };
const WATER = ['very low', 'low', 'moderate', 'high'];
const bySpecies = (id: string) => lib.species.find((s) => s.id === id)!;

describe('concept generator', () => {
  it('is repeatable from a seed and different from another', () => {
    const a = generateConcept(ctx, BOTH, mulberry32(5));
    expect(generateConcept(ctx, BOTH, mulberry32(5))).toEqual(a);
    expect(JSON.stringify(generateConcept(ctx, BOTH, mulberry32(6)))).not.toBe(JSON.stringify(a));
  });

  it('builds a patio, a path and beds in free space, clear of buildings, easements and each other', () => {
    let withPath = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = generateConcept(ctx, { ...BOTH, plants: false }, mulberry32(seed));
      const fresh = r.data.hardscape.filter((e) => !e.existing);
      expect(r.counts.patio).toBe(1);
      expect(r.counts.beds).toBeGreaterThanOrEqual(2);
      withPath += r.counts.path;
      const polys = fresh.map((e) => ({ el: e, poly: footprint(e, engine.hardscape) }));
      for (const { poly } of polys) {
        for (const s of structures) {
          expect(polygonsIntersect(poly, s.footprint)).toBe(false);
          for (const [x, y] of poly) expect(distanceToPolygon(x, y, s.footprint)).toBeGreaterThanOrEqual(engine.concept.structureMarginFt - 1e-6);
        }
        for (const e of site.easements) expect(polygonsIntersect(poly, e.polygon)).toBe(false);
        for (const old of r.data.hardscape.filter((h) => h.existing)) expect(polygonsIntersect(poly, footprint(old, engine.hardscape))).toBe(false);
        for (const [x, y] of poly) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(site.lot.width);
          expect(y).toBeLessThanOrEqual(site.lot.depth);
        }
      }
      // beds do not overlap the patio or each other
      const beds = polys.filter((p) => p.el.type === 'bed');
      const patio = polys.find((p) => p.el.type === 'patio')!;
      for (let i = 0; i < beds.length; i++) {
        expect(polygonsIntersect(beds[i].poly, patio.poly)).toBe(false);
        for (let j = i + 1; j < beds.length; j++) expect(polygonsIntersect(beds[i].poly, beds[j].poly)).toBe(false);
      }
      expect(patio.el.materialId && mats.find((m) => m.id === patio.el.materialId)!.category).toBe('paving');
      expect(fresh.every((e) => !e.existing && e.height >= 0)).toBe(true);
    }
    expect(withPath).toBeGreaterThan(15); // most concepts find room for a path
  });

  it('keeps the yard\'s existing hardscape and copies nothing else', () => {
    const r = generateConcept(ctx, BOTH, mulberry32(3));
    expect(r.data.hardscape.filter((e) => e.existing)).toEqual(owner.hardscape);
    expect(r.data.instances.every((i) => !i.existing)).toBe(true);
  });

  it('draws plants only from the starred palette, with room to grow, never on paving, close to buildings or in the easement', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = generateConcept(ctx, BOTH, mulberry32(seed));
      expect(r.counts.plants).toBeGreaterThanOrEqual(5);
      expect(r.counts.plants).toBeLessThanOrEqual(engine.concept.plants.count[1]);
      const fresh = r.data.hardscape.filter((e) => !e.existing);
      const trees = r.data.instances.filter((i) => bySpecies(i.speciesId).type === 'tree');
      expect(trees.length).toBeLessThanOrEqual(engine.concept.plants.maxTrees);
      for (const inst of r.data.instances) {
        const sp = bySpecies(inst.speciesId);
        expect(ctx.palette[sp.id]).toBe(true);
        expect(sp.invasive).toBe(false);
        for (const s of structures) {
          expect(pointInPolygon(inst.position[0], inst.position[1], s.footprint)).toBe(false);
          expect(distanceToPolygon(inst.position[0], inst.position[1], s.footprint)).toBeGreaterThanOrEqual(sp.roots.minFoundationFt - 1e-6);
        }
        for (const e of fresh.filter((x) => x.type !== 'bed')) expect(pointInPolygon(inst.position[0], inst.position[1], footprint(e, engine.hardscape))).toBe(false);
        for (const e of site.easements) expect(pointInPolygon(inst.position[0], inst.position[1], e.polygon)).toBe(false);
      }
      for (let i = 0; i < r.data.instances.length; i++) for (let j = i + 1; j < r.data.instances.length; j++) {
        const a = bySpecies(r.data.instances[i].speciesId), b = bySpecies(r.data.instances[j].speciesId);
        if ((a.type === 'groundcover') !== (b.type === 'groundcover')) continue;
        const d = Math.hypot(r.data.instances[i].position[0] - r.data.instances[j].position[0], r.data.instances[i].position[1] - r.data.instances[j].position[1]);
        expect(d).toBeGreaterThanOrEqual(engine.concept.plants.overlapAllowance * (a.matureWidth + b.matureWidth) / 2 - 1e-6);
      }
    }
  });

  it('keeps one water-use family so plants that share a bed share a hydrozone', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = generateConcept(ctx, BOTH, mulberry32(seed));
      const levels = r.data.instances.map((i) => WATER.indexOf(bySpecies(i.speciesId).wucols));
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(2 * engine.concept.plants.waterSpread);
    }
  });

  it('explains itself when the palette is too small, and still builds the hardscape', () => {
    const two = { ...ctx, palette: { 'salvia-leucantha': true, 'achillea-millefolium': true } };
    const r = generateConcept(two, BOTH, mulberry32(1));
    expect(r.counts.plants).toBe(0);
    expect(r.counts.patio).toBe(1);
    expect(r.notes.join(' ')).toContain('Star at least');
    const none = generateConcept({ ...ctx, palette: {} }, { hardscape: false, plants: true, starredOnly: true }, mulberry32(1));
    expect(none.counts.plants + none.counts.patio + none.counts.beds).toBe(0);
  });

  it('can draw from the whole library instead of the palette', () => {
    const small = { ...ctx, palette: { 'salvia-leucantha': true } };
    const used = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) generateConcept(small, { hardscape: true, plants: true, starredOnly: false }, mulberry32(seed)).data.instances.forEach((i) => used.add(i.speciesId));
    expect(used.size).toBeGreaterThan(8);
    expect([...used].every((id) => !bySpecies(id).invasive)).toBe(true);
  });

  it('builds only what is asked for', () => {
    const plantsOnly = generateConcept(ctx, { hardscape: false, plants: true, starredOnly: true }, mulberry32(2));
    expect(plantsOnly.data.hardscape.filter((e) => !e.existing)).toEqual([]);
    expect(plantsOnly.counts.plants).toBeGreaterThan(0);
    const hardOnly = generateConcept(ctx, { hardscape: true, plants: false, starredOnly: true }, mulberry32(2));
    expect(hardOnly.data.instances).toEqual([]);
  });
});

describe('shuffling with the starred palette', () => {
  it('swaps only for starred species', () => {
    // A plant with plenty of look-alikes, so the palette really is what limits the choice.
    const sp = [...lib.species].sort((x, y) => lookAlikes(y, lib.species, engine.shuffle.sizeRatioBand).length - lookAlikes(x, lib.species, engine.shuffle.sizeRatioBand).length)[0];
    const options = lookAlikes(sp, lib.species, engine.shuffle.sizeRatioBand);
    expect(options.length).toBeGreaterThan(3);
    const d = emptyScenarioData(site);
    d.instances = [{ id: 'a', speciesId: sp.id, position: [36, 105], plantedMonth: 0, container: '5gal', existing: false }];
    d.palette = { [options[0].id]: true, [options[1].id]: true };
    const run = { species: true, positions: false, materials: false, colors: false, time: false, starredOnly: true };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(shuffleScenario(d, { site, structures, species: lib.species, materials: mats, engine }, run, mulberry32(seed)).data.instances[0].speciesId);
    }
    for (const id of seen) expect([options[0].id, options[1].id]).toContain(id);
    expect(seen.size).toBe(2);
    // without the palette restriction it reaches beyond those two
    const wide = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      wide.add(shuffleScenario(d, { site, structures, species: lib.species, materials: mats, engine }, { ...run, starredOnly: false }, mulberry32(seed)).data.instances[0].speciesId);
    }
    expect(wide.size).toBeGreaterThan(3);
    d.palette = {};
    const none = shuffleScenario(d, { site, structures, species: lib.species, materials: mats, engine }, run, mulberry32(1));
    expect(none.data.instances[0].speciesId).toBe(sp.id);
    expect(none.changes.species).toBe(0);
  });
});

describe('new concept in the store', () => {
  it('creates a separate scenario, keeps the palette and leaves the original untouched', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    g().addInstance('salvia-leucantha', [36, 105]);
    const originalId = g().activeScenarioId;
    const before = JSON.stringify({ i: g().instances, h: g().hardscape });
    const palette = { ...g().palette };
    const r = g().generateConcept(BOTH, { seed: 8 })!;
    expect(r.scenarioId).toBeTruthy();
    expect(g().activeScenarioId).toBe(r.scenarioId);
    expect(g().scenarios.find((x) => x.id === r.scenarioId)!.name).toBe('Concept 1');
    expect(g().palette).toEqual(palette);
    expect(g().instances.some((i) => i.id === 'a' || (i.speciesId === 'salvia-leucantha' && i.position[0] === 36 && i.position[1] === 105))).toBe(false);
    expect(g().instances.length).toBe(r.counts.plants);
    g().switchScenario(originalId);
    expect(JSON.stringify({ i: g().instances, h: g().hardscape })).toBe(before);
    expect(g().generateConcept(BOTH, { seed: 8 })!.counts).toEqual(r.counts);
  });

  it('adds no scenario when nothing could be built, and does nothing in view mode', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    Object.keys(g().palette).forEach((id) => g().setPaletteSpecies(id, false));
    const n = g().scenarios.length;
    const r = g().generateConcept({ hardscape: false, plants: true, starredOnly: true })!;
    expect(r.scenarioId).toBeNull();
    expect(r.notes.length).toBeGreaterThan(0);
    expect(g().scenarios.length).toBe(n);
    expect(makeAppStore('view').getState().generateConcept(BOTH)).toBeNull();
  });
});
