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

describe('the mature ficus from the site file', () => {
  const trees: ContextTree[] = site.contextObjects
    .filter((o) => o.kind === 'tree' && o.position)
    .map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], height: o.height, width: o.canopyWidth ?? 10 }));
  const ficus = trees.find((t) => t.id === 'ficus')!;
  const parts = site.structures.filter((s) => s.group === 'adu');
  const gapStart = garage.footprint[2][1]; // the garage's rear face
  const gapEnd = Math.min(...parts.map((p) => p.footprint[0][1])); // the ADU's front wall

  it('has its trunk where the owner marked it on the plan screenshot, in the gap between the garage and the ADU', () => {
    expect(ficus).toBeDefined();
    expect(ficus.x).toBeCloseTo(10.9, 1);
    expect(ficus.y).toBeCloseTo(116.4, 1);
    expect(ficus.y).toBeGreaterThan(gapStart);
    expect(ficus.y).toBeLessThan(gapEnd);
    expect(gapEnd - gapStart).toBeCloseTo(19.9, 1); // the gap printed on the plot plan
    expect(ficus.y - gapStart).toBeGreaterThan(12); // about 13 ft north of the garage
    expect(gapEnd - ficus.y).toBeGreaterThan(6); // about 7 ft south of the ADU
  });

  it('is one large tree, not two small placeholders', () => {
    expect(ficus.width).toBeGreaterThan(gapEnd - gapStart); // the canopy spans the gap
    expect(ficus.height).toBeGreaterThan(Math.max(...parts.map((p) => p.ridgeHeight)));
    expect(trees.filter((t) => t.y > gapStart && t.y < gapEnd).length).toBe(1);
    expect(trees.some((t) => t.id === 'tree-adu-corner' || t.id === 'tree-rear-1')).toBe(false);
  });

  it('is flagged as a placeholder until measured, and the scan reports its canopy reaching the garage', () => {
    const obj = site.contextObjects.find((o) => o.id === 'ficus')!;
    expect(obj.placeholder).toBe(true);
    const found = detectConflicts({ instances: [], palette: {}, species: lib.species, structures: site.structures, elements: [], easements: site.easements, contextTrees: trees, lot: site.lot, cfg: engine, maxMonths: 12 });
    const hits = found.filter((c) => c.subjects.includes('ctx:ficus') && c.kind === 'structure');
    expect(hits.some((h) => h.message.includes('Garage'))).toBe(true);
    expect(hits[0].message).toContain('Mature ficus');
    expect(hits.every((h) => h.instanceIds.length === 0)).toBe(true); // a site tree, so listed apart from the owner's plants
  });

  it('flags a tree planted under its canopy, but treats a shrub there as understory', () => {
    const scan = (id: string) => detectConflicts({ instances: [inst(id, 12, 125)], palette: { [id]: true }, species: lib.species, structures: [], elements: [], easements: [], contextTrees: trees, lot: site.lot, cfg: engine, maxMonths: 360 });
    expect(scan('cercis-occidentalis').some((c) => c.kind === 'overlap' && c.subjects.includes('ctx:ficus'))).toBe(true);
    expect(scan('ceanothus-concha').some((c) => c.kind === 'overlap' && c.subjects.includes('ctx:ficus'))).toBe(false);
  });
});

describe('planting near the house', () => {
  const house = site.structures.filter((s) => s.group === 'house');
  const scan = (x: number, y: number) =>
    detectConflicts({ instances: [inst('cercis-occidentalis', x, y)], palette: { 'cercis-occidentalis': true }, species: lib.species, structures: house, elements: [], easements: [], contextTrees: [], lot: site.lot, cfg: engine, maxMonths: 12 }).filter((c) => c.kind === 'foundation');

  it('reports the house once, at its nearest wall, however many parts it has', () => {
    // (12, 62) is in the northwest cut-out: 3.5 ft from the west wing's north wall, 5.5 ft from the rear wing's west wall.
    const f = scan(12, 62);
    expect(f.length).toBe(1);
    expect(f[0].message).toContain('House (E) SFH');
    expect(f[0].message).toContain('3.5 ft');
    expect(f[0].message).not.toContain('wing'); // named for the building, not one of its wings
  });

  it('measures from the right wall elsewhere around the house', () => {
    expect(scan(12, 70)[0].message).toContain('6.7 ft'); // north of the cut-out, from the rear wing's northwest corner
    expect(scan(20, 22)[0].message).toContain('3.0 ft'); // south of the front porch
    expect(scan(30, 5).length).toBe(0); // far from the house
  });

  it('reports a canopy touching the house once, not once per gable', () => {
    const found = detectConflicts({ instances: [inst('cercis-occidentalis', 38, 22, { existing: true, currentHeight: 14, currentWidth: 16 })], palette: { 'cercis-occidentalis': true }, species: lib.species, structures: house, elements: [], easements: [], contextTrees: [], lot: site.lot, cfg: engine, maxMonths: 12 });
    expect(found.filter((c) => c.kind === 'structure').length).toBe(1);
    expect(found.filter((c) => c.kind === 'roof').length).toBe(1); // a 14 ft tree is above the eaves
  });
});
