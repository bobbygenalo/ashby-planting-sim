import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { quickItems, searchQuick } from '../src/engine/quickfind';
import { makeAppStore } from '../src/store/store';
import type { EngineConfig, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const items = quickItems(lib.species, { 'rosa-iceberg': true }, engine.hardscape);

describe('quick find', () => {
  it('lists every plant and every drawable hardscape type, a raised bed once per shape', () => {
    expect(items.filter((i) => i.kind === 'plant')).toHaveLength(lib.species.length);
    const hs = items.filter((i) => i.kind === 'hardscape');
    expect(hs.filter((i) => i.hardscape!.type === 'raisedBed').map((i) => i.hardscape!.shape)).toEqual(engine.hardscape.raisedBedModule.shapes.map((s) => s.id));
    for (const t of engine.hardscape.notDrawable ?? []) expect(hs.some((i) => i.hardscape!.type === t), t).toBe(false);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('finds a plant by common name, botanical name, or a part of either', () => {
    expect(searchQuick(items, 'iceberg')[0].speciesId).toBe('rosa-iceberg');
    expect(searchQuick(items, 'rosa californica')[0].speciesId).toBe('rosa-californica');
    expect(searchQuick(items, 'meyer')[0].speciesId).toBe('citrus-meyer-lemon');
    expect(searchQuick(items, 'ROSE').some((i) => i.speciesId === 'rosa-knock-out')).toBe(true);
  });

  it('ranks a name that starts with the word above one that merely contains it, and every word must match', () => {
    const r = searchQuick(items, 'rose').map((i) => i.label);
    expect(r[0].toLowerCase()).toMatch(/\brose\b/);
    expect(r.indexOf('Rosemary')).toBeGreaterThan(r.findIndex((l) => /Knock Out rose/.test(l))); // the whole word comes first
    const both = searchQuick(items, 'wild rose');
    expect(both[0].speciesId).toBe('rosa-californica');
    expect(searchQuick(items, 'zzzz')).toEqual([]);
    expect(searchQuick(items, 'rose zzzz')).toEqual([]);
  });

  it('finds hardscape by name and by what people call it', () => {
    expect(searchQuick(items, 'patio')[0].hardscape?.type).toBe('patio');
    const beds = searchQuick(items, 'raised').filter((i) => i.hardscape?.type === 'raisedBed');
    expect(beds).toHaveLength(5);
    expect(searchQuick(items, 'planter')[0].hardscape?.type).toBe('raisedBed');
    expect(searchQuick(items, 'raised bed L')[0].hardscape?.shape).toBe('L');
  });

  it('finds by light, water and kind: "native shade" turns up California natives that want shade', () => {
    const r = searchQuick(items, 'native shade', 100);
    expect(r.length).toBeGreaterThan(0);
    for (const i of r) {
      const s = lib.species.find((q) => q.id === i.speciesId)!;
      expect(s.origin).toBe('california native');
    }
  });

  it('with nothing typed lists the hardscape and the starred plants, and the same query gives the same order', () => {
    const start = searchQuick(items, '');
    expect(start.some((i) => i.speciesId === 'rosa-iceberg')).toBe(true);
    expect(start.every((i) => i.kind === 'hardscape' || i.starred)).toBe(true);
    expect(searchQuick(items, 'sage').map((i) => i.id)).toEqual(searchQuick(items, 'sage').map((i) => i.id));
    expect(searchQuick(items, 'sage', 3)).toHaveLength(3);
  });
});

describe('quick find in the store', () => {
  it('opens and closes, only where the plan can be changed', () => {
    const s = makeAppStore('edit');
    s.getState().setQuickFind(true);
    expect(s.getState().quickFindOpen).toBe(true);
    s.getState().setQuickFind(false);
    expect(s.getState().quickFindOpen).toBe(false);
    const v = makeAppStore('view');
    v.getState().setQuickFind(true);
    expect(v.getState().quickFindOpen).toBe(false);
  });

  it('lets go of everything on Escape: the plants placed along the way are not left selected', () => {
    const s = makeAppStore('edit');
    s.getState().chooseQuick(items.find((i) => i.speciesId === 'rosmarinus-officinalis')!);
    expect(s.getState().placingSpeciesId).toBe('rosmarinus-officinalis');
    const a = s.getState().addInstance('rosmarinus-officinalis', [30, 60])!;
    s.getState().addInstance('rosmarinus-officinalis', [34, 60]);
    expect(s.getState().instances.length).toBeGreaterThanOrEqual(2);
    expect(s.getState().selectedId).not.toBe(a); // the last one placed is the selection while placing
    s.getState().setPlacing(null); // what Escape does
    expect(s.getState().placingSpeciesId).toBeNull();
    expect(s.getState().selectedId).toBeNull();
    expect(s.getState().selectedElementId).toBeNull();
    expect(s.getState().hiveSelected).toBe(false);
  });

  it('keeps placing: any number of clicks place any number of plants, and only Escape or Stop placing lets go', () => {
    const s = makeAppStore('edit');
    s.getState().chooseQuick(items.find((i) => i.speciesId === 'rosmarinus-officinalis')!);
    const before = s.getState().instances.length;
    for (let n = 0; n < 12; n++) {
      s.getState().addInstance('rosmarinus-officinalis', [20 + n * 2, 60]);
      expect(s.getState().placingSpeciesId, `after ${n + 1} placed`).toBe('rosmarinus-officinalis');
      expect(s.getState().drawing).toBeNull();
    }
    expect(s.getState().instances.length).toBe(before + 12);
    expect(s.getState().placedRun).toBe(12);
    // nothing else the plan does while placing lets go of it
    s.getState().setHover([30, 60]);
    s.getState().select(s.getState().instances[0].id);
    s.getState().selectElement(null);
    expect(s.getState().placingSpeciesId).toBe('rosmarinus-officinalis');
    s.getState().setPlacing(null);
    expect(s.getState().placingSpeciesId).toBeNull();
    expect(s.getState().placedRun).toBe(0);
  });

  it('also starts clean: something selected before is not selected after a placing session', () => {
    const s = makeAppStore('edit');
    const first = s.getState().addInstance('rosmarinus-officinalis', [30, 60])!;
    s.getState().select(first);
    s.getState().chooseQuick(items.find((i) => i.speciesId === 'salvia-clevelandii')!);
    expect(s.getState().selectedId).toBeNull();
    s.getState().setPlacing(null);
    expect(s.getState().selectedId).toBeNull();
  });

  it('starts placing a plant or drawing a hardscape item, and Escape-style cancel drops it', () => {
    const s = makeAppStore('edit');
    s.getState().chooseQuick(items.find((i) => i.speciesId === 'rosa-iceberg')!);
    expect(s.getState().placingSpeciesId).toBe('rosa-iceberg');
    expect(s.getState().quickFindOpen).toBe(false);
    s.getState().setPlacing(null);
    expect(s.getState().placingSpeciesId).toBeNull();
    s.getState().chooseQuick(items.find((i) => i.hardscape?.shape === 'U')!);
    expect(s.getState().drawing).toMatchObject({ type: 'raisedBed', shape: 'U' });
    expect(s.getState().placingSpeciesId).toBeNull();
    s.getState().startDrawing(null);
    expect(s.getState().drawing).toBeNull();
  });
});
