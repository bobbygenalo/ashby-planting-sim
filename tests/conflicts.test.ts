import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { detectConflicts, overlapApplies, type Conflict, type ContextTree } from '../src/engine/conflicts';
import { instanceSize } from '../src/engine/growth';
import { loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const site = loadSite(siteRaw);
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const garage = site.structures.find((s) => s.id === 'garage')!;
let n = 0;
const inst = (speciesId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: `c${n++}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false, ...over,
});

const run = (instances: PlantInstance[], over: { elements?: HardscapeElement[]; contextTrees?: ContextTree[] } = {}): Conflict[] =>
  detectConflicts({
    instances, palette: Object.fromEntries(lib.species.map((s) => [s.id, true])), species: lib.species,
    structures: site.structures, elements: over.elements ?? [], easements: site.easements, contextTrees: over.contextTrees ?? [],
    lot: site.lot, cfg: engine, maxMonths: engine.timeline.maxYears * 12,
  });
const of = (list: Conflict[], kind: string) => list.filter((c) => c.kind === kind);

describe('M6 acceptance: a tree 3 ft from the garage reports a conflict with the year it first occurs', () => {
  const tree = inst('cercis-occidentalis', 10, garage.footprint[0][1] - 3, { container: '15gal' });
  const result = run([tree]);

  it('flags the trunk as too close to the foundation from the day of planting', () => {
    const f = of(result, 'foundation')[0];
    expect(f).toBeDefined();
    expect(f.firstMonth).toBe(0);
    expect(f.atPlanting).toBe(true);
    expect(f.message).toContain('3.0 ft');
  });

  it('flags the canopy touching the garage in the first month it does, matching an independent scan of the growth curve', () => {
    const s = sp('cercis-occidentalis');
    let expected = -1;
    for (let m = 0; m <= 360; m++) {
      if (instanceSize(tree, s, m, engine.growth).width / 2 + engine.conflicts.structureClearanceFt >= 3) { expected = m; break; }
    }
    expect(expected).toBeGreaterThan(0);
    const c = of(result, 'structure')[0];
    expect(c.firstMonth).toBe(expected);
    expect(c.atPlanting).toBe(false);
    expect(c.message).toContain(`in year ${(expected / 12).toFixed(1)}`);
  });

  it('flags the canopy reaching the roof once the tree is taller than the eave and wide enough', () => {
    const s = sp('cercis-occidentalis');
    let expected = -1;
    for (let m = 0; m <= 360; m++) {
      const z = instanceSize(tree, s, m, engine.growth);
      if (z.height >= garage.eaveHeight && z.width / 2 >= 3) { expected = m; break; }
    }
    const c = of(result, 'roof')[0];
    expect(c.firstMonth).toBe(expected);
    expect(c.firstMonth).toBeGreaterThan(of(result, 'structure')[0].firstMonth - 1);
  });

  it('is sorted with the earliest conflicts first', () => {
    const months = result.map((c) => c.firstMonth);
    expect(months).toEqual([...months].sort((a, b) => a - b));
  });
});

describe('conflict kinds', () => {
  it('reports nothing for a well-placed plant', () => {
    expect(run([inst('salvia-clevelandii', 30, 90)])).toEqual([]);
  });

  it('flags two shrubs whose canopies grow into each other, in the month overlap passes the tolerance', () => {
    const a = inst('ceanothus-concha', 30, 90), b = inst('ceanothus-concha', 34, 90); // 4 ft apart, 6 ft wide when mature
    const c = of(run([a, b]), 'overlap')[0];
    expect(c).toBeDefined();
    const s = sp('ceanothus-concha');
    let expected = -1;
    for (let m = 0; m <= 360; m++) {
      const w = instanceSize(a, s, m, engine.growth).width;
      if (w - 4 > engine.conflicts.overlapToleranceFt) { expected = m; break; } // both widths equal: overlap = w - distance
    }
    expect(c.firstMonth).toBe(expected);
    expect(c.instanceIds.sort()).toEqual([a.id, b.id].sort());
    expect(c.severity).toBe('warning');
  });

  it('does not flag understory and groundcover under a taller plant', () => {
    const tree = inst('cercis-occidentalis', 30, 90, { existing: true, currentHeight: 14, currentWidth: 14 });
    const low = inst('salvia-bees-bliss', 31, 90, { existing: true, currentHeight: 1.5, currentWidth: 6 });
    const cover = inst('phyla-nodiflora', 32, 91, { existing: true, currentHeight: 0.3, currentWidth: 6 });
    expect(of(run([tree, low, cover]), 'overlap')).toEqual([]);
    expect(overlapApplies({ sp: sp('salvia-bees-bliss'), height: 1.5 }, { sp: sp('cercis-occidentalis'), height: 14 }, engine.conflicts)).toBe(false);
    expect(overlapApplies({ sp: sp('ceanothus-concha'), height: 5 }, { sp: sp('ceanothus-concha'), height: 6 }, engine.conflicts)).toBe(true);
  });

  it('flags a trunk near paving, and ignores it when the paving is removed or is a bed', () => {
    const patio: HardscapeElement = { id: 'p', type: 'patio', points: [[30, 70], [40, 70], [40, 82], [30, 82]], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false };
    const t = inst('heteromeles-arbutifolia', 28, 76); // 2 ft from the patio edge, tree wants 5
    expect(of(run([t], { elements: [patio] }), 'paving')[0].atPlanting).toBe(true);
    expect(of(run([t], { elements: [{ ...patio, removed: true }] }), 'paving')).toEqual([]);
    expect(of(run([t], { elements: [{ ...patio, type: 'bed', materialId: 'soil-bed' }] }), 'paving')).toEqual([]);
  });

  it('flags a tree near the lot line from planting', () => {
    const c = of(run([inst('cercis-occidentalis', 2, 100)]), 'lot-line');
    expect(c.length).toBe(1);
    expect(c[0].severity).toBe('warning');
    expect(of(run([inst('cercis-occidentalis', 20, 100)]), 'lot-line')).toEqual([]);
  });

  it('flags height reaching the overhead-line cap in the rear easement, at the month it gets there', () => {
    const t = inst('cercis-occidentalis', 4, 148, { container: '15gal' }); // 15 ft mature, 15 ft cap
    const c = of(run([t]), 'overhead')[0];
    expect(c).toBeDefined();
    const s = sp('cercis-occidentalis');
    let expected = -1;
    for (let m = 0; m <= 360; m++) if (instanceSize(t, s, m, engine.growth).height >= 15) { expected = m; break; }
    expect(c.firstMonth).toBe(expected);
    // A shorter plant never reaches the cap, and a tall one outside the easement is fine.
    expect(of(run([inst('salvia-clevelandii', 4, 148)]), 'overhead')).toEqual([]);
    expect(of(run([inst('cercis-occidentalis', 30, 100)]), 'overhead')).toEqual([]);
  });

  it('checks existing plants from month zero and includes site trees against new plants', () => {
    const ex = inst('cercis-occidentalis', 10, 79.5, { existing: true, currentHeight: 12, currentWidth: 12 });
    const c = of(run([ex]), 'structure')[0];
    expect(c.firstMonth).toBe(0);
    const ctx: ContextTree = { id: 't', name: 'Site tree', x: 30, y: 90, height: 8, width: 10 };
    const near = inst('ceanothus-concha', 33, 90);
    expect(of(run([near], { contextTrees: [ctx] }), 'overlap').length).toBe(1);
    expect(of(run([], { contextTrees: [ctx, { ...ctx, id: 'u', x: 31 }] }), 'overlap')).toEqual([]);
  });

  it('skips deselected species, and does not start a conflict before the plant exists', () => {
    const t = inst('cercis-occidentalis', 10, 79.5);
    const off = detectConflicts({ instances: [t], palette: {}, species: lib.species, structures: site.structures, elements: [], easements: [], contextTrees: [], lot: site.lot, cfg: engine, maxMonths: 360 });
    expect(off).toEqual([]);
    const later = inst('cercis-occidentalis', 10, 79.5, { plantedMonth: 24 });
    expect(of(run([later]), 'foundation')[0].firstMonth).toBe(24);
    expect(of(run([later]), 'structure')[0].firstMonth).toBeGreaterThan(24);
  });

  it('ignores structure contact for vines meant to climb', () => {
    expect(of(run([inst('bougainvillea', 10, 80.5)]), 'structure')).toEqual([]);
  });
});
