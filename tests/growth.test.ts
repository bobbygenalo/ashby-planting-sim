import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import siteRaw from '../src/data/site.json';
import { instanceSize, isBlooming, isLeafOff, placedPlants, plantSolid, sizeAt, sunFit } from '../src/engine/growth';
import { activeInstances, filterSpecies, makeCustomSpecies, type CustomSpeciesInput } from '../src/engine/library';
import { buildSunScene, loadSite } from '../src/engine/site';
import { computeSunHours } from '../src/engine/sunhours';
import type { EngineConfig, PlantInstance, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const site = loadSite(siteRaw);
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const inst = (speciesId: string, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: 'a', speciesId, position: [30, 40], plantedMonth: 0, container: '5gal', existing: false, ...over,
});

describe('growth curve', () => {
  it('starts at S0, reaches Sm at T, holds after, and is monotonic', () => {
    expect(sizeAt(2, 10, 0, 5, 8)).toBe(2);
    expect(sizeAt(2, 10, 5, 5, 8)).toBe(10);
    expect(sizeAt(2, 10, 9, 5, 8)).toBe(10);
    let prev = 2;
    for (let t = 0.1; t < 5; t += 0.1) {
      const s = sizeAt(2, 10, t, 5, 8);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('hits the midpoint at T/2 (symmetric logistic)', () => {
    expect(sizeAt(0, 10, 2.5, 5, 8)).toBeCloseTo(5, 6);
  });

  it('a placed tree reaches its mature height and width at its years to maturity', () => {
    const s = sp('cercis-occidentalis');
    const i = inst(s.id, { container: '15gal' });
    const atT = instanceSize(i, s, s.yearsToMaturity * 12, engine.growth);
    expect(atT.height).toBeCloseTo(s.matureHeight, 6);
    expect(atT.width).toBeCloseTo(s.matureWidth, 6);
    const later = instanceSize(i, s, 30 * 12, engine.growth);
    expect(later.height).toBe(s.matureHeight);
    const start = instanceSize(i, s, 0, engine.growth);
    expect(start.height).toBeCloseTo(engine.growth.containers['15gal'].height, 6);
  });

  it('is not planted before its planting month, and existing plants keep the entered size', () => {
    const s = sp('salvia-leucantha');
    expect(instanceSize(inst(s.id, { plantedMonth: 12 }), s, 6, engine.growth).planted).toBe(false);
    const ex = inst(s.id, { existing: true, currentHeight: 3.2, currentWidth: 4.1 });
    expect(instanceSize(ex, s, 100, engine.growth)).toEqual({ planted: true, height: 3.2, width: 4.1 });
  });

  it('never starts bigger than the capped fraction of mature size', () => {
    const s = sp('phyla-nodiflora'); // a very low groundcover
    const z = instanceSize(inst(s.id, { container: '24box' }), s, 0, engine.growth);
    expect(z.height).toBeCloseTo(s.matureHeight * engine.growth.maxStartFractionOfMature, 6);
  });
});

describe('library and palette', () => {
  it('ships species covering the required plant types with provenance defaults', () => {
    const types = new Set(lib.species.map((s) => s.type));
    for (const t of ['tree', 'shrub', 'perennial', 'grass', 'groundcover', 'vine', 'succulent', 'edible']) expect(types.has(t as never)).toBe(true);
    expect(lib.provenanceDefault.confidence).toBe('low');
    const ids = lib.species.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by pollinator value, group, bloom month, origin and toxicity', () => {
    const hi = filterSpecies(lib.species, { pollinator: 'high' });
    expect(hi.length).toBeGreaterThan(5);
    expect(hi.every((s) => s.pollinator.value === 'high')).toBe(true);
    expect(filterSpecies(lib.species, { group: 'hummingbirds' }).every((s) => s.pollinator.groups.includes('hummingbirds'))).toBe(true);
    expect(filterSpecies(lib.species, { bloomMonth: 1 }).every((s) => s.bloomMonths.includes(1))).toBe(true);
    expect(filterSpecies(lib.species, { origin: 'california native', nonToxicOnly: true }).every((s) => s.origin === 'california native' && !s.toxic)).toBe(true);
    expect(filterSpecies(lib.species, { text: 'cleveland' })[0].id).toBe('salvia-clevelandii');
  });

  it('treats the palette as a star shortlist: it never hides placed plants, and any plant can be placed', () => {
    const a = inst('salvia-leucantha', { id: 'a' });
    const b = inst('salvia-clevelandii', { id: 'b' });
    const off = { 'salvia-leucantha': true, 'salvia-clevelandii': false };
    expect(activeInstances([a, b], off).map((i) => i.id)).toEqual(['a', 'b']);
    expect(placedPlants([a, b], off, lib.species, 0, engine.growth)).toHaveLength(2);
    const store = makeAppStore('edit');
    store.getState().setPaletteSpecies('salvia-clevelandii', false); // not starred
    const id = store.getState().addInstance('salvia-clevelandii', [20, 40])!;
    expect(id).toBeTruthy();
    store.getState().setPaletteSpecies('salvia-clevelandii', true);
    store.getState().setPaletteSpecies('salvia-clevelandii', false);
    expect(activeInstances(store.getState().instances, store.getState().palette).some((i) => i.id === id)).toBe(true);
  });

  it('view mode cannot add, move or delete plants', () => {
    const view = makeAppStore('view');
    expect(view.getState().addInstance('salvia-leucantha', [10, 10])).toBeNull();
    const edit = makeAppStore('edit');
    const id = edit.getState().addInstance('salvia-leucantha', [10, 10])!;
    edit.setState({ mode: 'view' });
    edit.getState().updateInstance(id, { position: [1, 1] });
    edit.getState().deleteInstance(id);
    expect(edit.getState().instances[0].position).toEqual([10, 10]);
  });
});

describe('sun interaction', () => {
  it('a tree shades more of the yard as it grows (SUN-7)', () => {
    const s = sp('cercis-occidentalis');
    const i = inst(s.id, { position: [28, 100], container: '15gal' });
    const meanBackHours = (month: number) => {
      const solids = placedPlants([i], { [s.id]: true }, lib.species, month, engine.growth).flatMap((p) => {
        const so = plantSolid(p.inst, p.species, p.size, engine.growth, 12);
        return so ? [so] : [];
      });
      const scene = buildSunScene(site, { aduEnabled: true }, engine, solids);
      const r = computeSunHours(scene, { period: { kind: 'day', month: 6, day: 21 }, year: 2026, config: engine.sun });
      let sum = 0;
      for (let k = 0; k < r.hours.length; k++) if (r.mask[k] === 1) sum += r.hours[k];
      return sum;
    };
    expect(meanBackHours(15 * 12)).toBeLessThan(meanBackHours(0) - 5);
  });

  it('flags light mismatches against the species need (SUN-6)', () => {
    expect(sunFit(sp('salvia-leucantha'), 3, engine.growth)).toBe('too-shaded');
    expect(sunFit(sp('salvia-leucantha'), 9, engine.growth)).toBe('ok');
    expect(sunFit(sp('heuchera-maxima'), 9.5, engine.growth)).toBe('too-sunny');
    expect(sunFit(sp('salvia-spathacea'), 9, engine.growth)).toBe('too-sunny');
  });
});

describe('library size and data quality', () => {
  it('carries the owner\'s data sheet: 26 rows, each with a confidence note', () => {
    const rows = lib.species.filter((s) => s.sheet);
    expect(rows).toHaveLength(26);
    expect(rows.every((s) => ['Recall only', 'Partly verified'].includes(s.sheet!.confidence))).toBe(true);
    expect(lib.species.find((s) => s.id === 'olea-frantoio')!.matureHeight).toBe(25);
    expect(lib.species.find((s) => s.id === 'eriogonum-grande-rubescens')!.botanical).toContain('rubescens');
  });

  it('ships about 50 species with sane data', () => {
    expect(lib.species.length).toBeGreaterThanOrEqual(55);
    for (const s of lib.species) {
      expect(s.matureHeight, s.id).toBeGreaterThan(0);
      expect(s.matureWidth, s.id).toBeGreaterThan(0);
      expect(s.yearsToMaturity, s.id).toBeGreaterThan(0);
      expect(s.bloomMonths.every((m) => m >= 1 && m <= 12), s.id).toBe(true);
      expect(['very low', 'low', 'moderate', 'high']).toContain(s.wucols);
      expect(engine.growth.wucolsPlantFactor[s.wucols], s.id).toBeDefined();
      if (!s.evergreen && s.type === 'tree') expect(s.leafOffMonths.length, s.id).toBeGreaterThan(0);
    }
    // The owner's named picks are all present.
    for (const id of ['salvia-leucantha', 'oenothera-lindheimeri', 'lomandra-longifolia', 'phyla-nodiflora', 'juncus-patens', 'tulbaghia-violacea']) {
      expect(lib.species.some((s) => s.id === id), id).toBe(true);
    }
  });

  it('covers every calendar month with at least one high-value bloom', () => {
    for (let m = 1; m <= 12; m++) {
      expect(lib.species.some((s) => s.pollinator.value === 'high' && isBlooming(s, m)), `month ${m}`).toBe(true);
    }
  });
});

describe('leaf-off (GR-4)', () => {
  const redbud = sp('cercis-occidentalis');
  const toyon = sp('heteromeles-arbutifolia');
  const cfg = engine.growth;

  it('flags deciduous species as leafless only in their leaf-off months', () => {
    expect(isLeafOff(redbud, 1)).toBe(true);
    expect(isLeafOff(redbud, 7)).toBe(false);
    expect(isLeafOff(toyon, 1)).toBe(false);
  });

  it('shadow solids carry a lower winter density for deciduous plants only', () => {
    const big = { planted: true, height: 15, width: 15 };
    const a = plantSolid(inst(redbud.id), redbud, big, cfg, 12)!;
    expect(a.leafOffMonths).toEqual(redbud.leafOffMonths);
    expect(a.leafOffDensity).toBeCloseTo(a.density * cfg.leafOffDensityFactor, 9);
    const b = plantSolid(inst(toyon.id), toyon, big, cfg, 12)!;
    expect(b.leafOffMonths).toBeUndefined();
  });

  it('a leafless tree casts less shade than a leafy one on the same cell', () => {
    const solids = (id: string) => {
      const s = sp(id);
      const so = plantSolid(inst(id, { position: [28, 100] }), s, { planted: true, height: 18, width: 16 }, cfg, 12)!;
      return [{ ...so, leafOffMonths: s.evergreen ? undefined : [1], leafOffDensity: so.leafOffDensity }];
    };
    const total = (extra: ReturnType<typeof solids>, month: number, day: number) => {
      const scene = buildSunScene(site, { aduEnabled: true }, engine, extra);
      const r = computeSunHours(scene, { period: { kind: 'day', month, day }, year: 2026, config: engine.sun });
      let sum = 0;
      for (let k = 0; k < r.hours.length; k++) if (r.mask[k] === 1) sum += r.hours[k];
      return sum;
    };
    const none = total([], 1, 15);
    const leafless = total(solids('cercis-occidentalis'), 1, 15);
    const leafy = total(solids('heteromeles-arbutifolia'), 1, 15);
    expect(none - leafless).toBeLessThan((none - leafy) * 0.6);
    expect(none - leafy).toBeGreaterThan(1);
  });
});

describe('custom species (PL-8)', () => {
  const good: CustomSpeciesInput = {
    common: 'My Test Shrub', type: 'shrub', origin: 'other', evergreen: true, matureHeight: 4, matureWidth: 5,
    yearsToMaturity: 4, habit: 'round', sun: 'full', wucols: 'low', bloomMonths: [5, 4, 4], bloomColor: '#ff00ff',
    pollinatorValue: 'moderate', groups: ['native bees'], invasive: false, toxic: false,
  };
  it('builds a species with owner provenance and unique id', () => {
    const r = makeCustomSpecies(good, ['custom-my-test-shrub']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.species.id).toBe('custom-my-test-shrub-2');
      expect(r.species.bloomMonths).toEqual([4, 5]);
      expect(r.species.provenance?.size?.source).toBe('Entered by the owner');
    }
  });
  it('rejects missing names and non-positive sizes', () => {
    const r = makeCustomSpecies({ ...good, common: ' ', matureHeight: 0, yearsToMaturity: -1 }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(3);
  });
  it('the store accepts custom species only in edit mode and selects them into the palette', () => {
    const r = makeCustomSpecies(good, []);
    if (!r.ok) throw new Error('unexpected');
    const view = makeAppStore('view');
    view.getState().addSpecies(r.species);
    expect(view.getState().library.species.some((s) => s.id === r.species.id)).toBe(false);
    const edit = makeAppStore('edit');
    edit.getState().addSpecies(r.species);
    expect(edit.getState().library.species.some((s) => s.id === r.species.id)).toBe(true);
    expect(edit.getState().palette[r.species.id]).toBe(true);
  });
});
