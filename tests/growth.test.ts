import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import siteRaw from '../src/data/site.json';
import { instanceSize, placedPlants, plantSolid, sizeAt, sunFit } from '../src/engine/growth';
import { activeInstances, filterSpecies } from '../src/engine/library';
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
    const s = sp('phyla-nodiflora'); // 0.3 ft tall mature
    const z = instanceSize(inst(s.id, { container: '24box' }), s, 0, engine.growth);
    expect(z.height).toBeCloseTo(0.3 * engine.growth.maxStartFractionOfMature, 6);
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

  it('deselecting a species hides its instances and totals without deleting them', () => {
    const a = inst('salvia-leucantha', { id: 'a' });
    const b = inst('salvia-clevelandii', { id: 'b' });
    const on = { 'salvia-leucantha': true, 'salvia-clevelandii': true };
    const off = { ...on, 'salvia-clevelandii': false };
    expect(activeInstances([a, b], on)).toHaveLength(2);
    expect(activeInstances([a, b], off).map((i) => i.id)).toEqual(['a']);
    expect(placedPlants([a, b], off, lib.species, 0, engine.growth)).toHaveLength(1);
    const store = makeAppStore('edit');
    store.getState().setPaletteSpecies('salvia-clevelandii', true);
    const id = store.getState().addInstance('salvia-clevelandii', [20, 40])!;
    store.getState().setPaletteSpecies('salvia-clevelandii', false);
    expect(store.getState().instances.some((i) => i.id === id)).toBe(true);
    expect(activeInstances(store.getState().instances, store.getState().palette).some((i) => i.id === id)).toBe(false);
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
    expect(sunFit(sp('agapanthus-africanus'), 9.5, engine.growth)).toBe('too-sunny');
    expect(sunFit(sp('salvia-spathacea'), 9, engine.growth)).toBe('too-sunny');
  });
});
