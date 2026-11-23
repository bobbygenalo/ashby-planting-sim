import { pairNeed } from '../src/engine/companions';
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
import type { EngineConfig, HardscapeElement, Material, SpeciesLibrary } from '../src/engine/types';
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
      for (const { el, poly } of polys) {
        for (const s of structures) {
          expect(polygonsIntersect(poly, s.footprint)).toBe(false);
          // a path ends at a door, so only paths may come closer than the margin
          if (el.type !== 'path') for (const [x, y] of poly) expect(distanceToPolygon(x, y, s.footprint)).toBeGreaterThanOrEqual(engine.concept.structureMarginFt - 1e-6);
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
      expect(r.counts.plants).toBeLessThanOrEqual(engine.concept.plants.maxTotal);
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
        for (const e of fresh.filter((x) => ['patio', 'deck', 'path', 'lawn'].includes(x.type))) expect(pointInPolygon(inst.position[0], inst.position[1], footprint(e, engine.hardscape))).toBe(false);
        for (const e of site.easements) expect(pointInPolygon(inst.position[0], inst.position[1], e.polygon)).toBe(false);
      }
      for (let i = 0; i < r.data.instances.length; i++) for (let j = i + 1; j < r.data.instances.length; j++) {
        const a = bySpecies(r.data.instances[i].speciesId), b = bySpecies(r.data.instances[j].speciesId);
        const d = Math.hypot(r.data.instances[i].position[0] - r.data.instances[j].position[0], r.data.instances[i].position[1] - r.data.instances[j].position[1]);
        // Crowns stay apart unless the pair is purposeful or beautiful (a drift, a shade plant under a tree, a contrast).
        expect(d, `${a.common} and ${b.common}`).toBeGreaterThanOrEqual(pairNeed(a, b, engine.concept.plants.overlapAllowance, engine.concept.plants.companions).need - 1e-6);
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
    expect(g().scenarios.find((x) => x.id === r.scenarioId)!.name).toBe(`Concept 1: ${r.theme}`);
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

describe('concept hardscape variety', () => {
  const colorDistance = (a: string, b: string) => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  const run = (seed: number) => generateConcept(ctx, { hardscape: true, plants: true, starredOnly: true }, mulberry32(seed));
  const fresh = (seed: number) => run(seed).data.hardscape.filter((e) => !e.existing);

  it('picks a theme and reaches every kind of element across themes', () => {
    const themes = new Set<string>();
    const types = new Set<string>();
    const materials = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = run(seed);
      themes.add(r.theme);
      for (const e of r.data.hardscape.filter((x) => !x.existing)) {
        types.add(e.type);
        materials.add(e.materialId);
      }
    }
    expect([...themes].sort()).toEqual(engine.concept.themes.map((t) => t.label).sort());
    for (const t of ['patio', 'path', 'bed', 'lawn', 'gravel', 'raisedBed']) expect(types.has(t), `${t} never appears`).toBe(true);
    for (const m of ['mulch', 'gravel', 'lawn', 'raised-bed-wood', 'soil-bed']) expect(materials.has(m), `${m} never appears`).toBe(true);
  });

  it('follows the theme: no lawn in a dry garden, raised beds in a kitchen garden, gravel and mulch where the theme asks', () => {
    let dry = 0, kitchen = 0, lawn = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const r = run(seed);
      const theme = engine.concept.themes.find((t) => t.label === r.theme)!;
      expect(r.counts.lawn).toBeLessThanOrEqual(theme.lawn[1]);
      expect(r.counts.gravel).toBeLessThanOrEqual(theme.gravel[1]);
      expect(r.counts.mulch).toBeLessThanOrEqual(theme.mulch[1]);
      expect(r.counts.raisedBeds).toBeLessThanOrEqual(theme.raisedBeds[1]);
      expect(r.counts.path).toBeLessThanOrEqual(engine.concept.path.max);
      if (theme.id === 'dry-garden') {
        dry++;
        expect(r.counts.lawn).toBe(0);
        expect(r.counts.raisedBeds).toBe(0);
        expect(r.counts.gravel + r.counts.mulch).toBeGreaterThan(0);
      }
      if (theme.id === 'kitchen-garden') {
        kitchen++;
        expect(r.counts.lawn).toBe(0);
      }
      if (theme.id === 'lawn-and-beds' && r.counts.lawn > 0) lawn++;
    }
    expect(dry).toBeGreaterThan(5);
    expect(kitchen).toBeGreaterThan(5);
    expect(lawn).toBeGreaterThan(5);
  });

  it('keeps every area clear of buildings, easements, trees and each other, inside its yard', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const els = fresh(seed).map((e) => ({ e, poly: footprint(e, engine.hardscape) }));
      for (const { e, poly } of els) {
        for (const s of structures) expect(polygonsIntersect(poly, s.footprint), `${e.name} meets a building`).toBe(false);
        for (const z of site.easements) expect(polygonsIntersect(poly, z.polygon), `${e.name} is in the easement`).toBe(false);
        for (const old of owner.hardscape) expect(polygonsIntersect(poly, footprint(old, engine.hardscape)), `${e.name} is on the driveway`).toBe(false);
        for (const [x, y] of poly) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(site.lot.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(site.lot.depth);
        }
      }
      // areas never overlap each other; a path starts on the edge of what it leaves, so paths are checked against the rest only
      const areas = els.filter((x) => x.e.type !== 'path');
      for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
        // a table or grill stands on the patio
        const onPatio = (a: HardscapeElement, b: HardscapeElement) => (a.type === 'table' || a.type === 'grill') && b.type === 'patio';
        if (onPatio(areas[i].e, areas[j].e) || onPatio(areas[j].e, areas[i].e)) continue;
        expect(polygonsIntersect(areas[i].poly, areas[j].poly), `${areas[i].e.name} overlaps ${areas[j].e.name}`).toBe(false);
      }
    }
  });

  it('gives every element a name and a color from its material, and a deck or path a real choice of material', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of fresh(seed)) {
        expect(e.name, `element ${e.id}`).toBeTruthy();
        expect(e.color).toBe(engine.concept.colors[e.materialId]);
        expect(mats.some((m) => m.id === e.materialId)).toBe(true);
        if (e.type === 'path') expect(engine.concept.path.materials).toContain(e.materialId);
        if (e.type === 'deck') expect(engine.concept.areas.deck.materials).toContain(e.materialId);
        if (e.type === 'raisedBed') expect(e.height).toBeGreaterThan(0);
      }
    }
  });

  it('uses a different material for each path where it can', () => {
    let multi = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const paths = fresh(seed).filter((e) => e.type === 'path');
      if (paths.length < 2) continue;
      multi++;
      expect(new Set(paths.map((p) => p.materialId)).size).toBe(Math.min(paths.length, engine.concept.path.materials.length));
    }
    expect(multi).toBeGreaterThan(10);
  });

  it('colors each material so a plan reads like a legend: no two materials look alike', () => {
    const entries = Object.entries(engine.concept.colors);
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const [id] of entries) expect(mats.some((m) => m.id === id), `${id} is not a material`).toBe(true);
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      expect(colorDistance(entries[i][1], entries[j][1]), `${entries[i][0]} and ${entries[j][0]} look alike`).toBeGreaterThan(35);
    }
  });

  it('puts mulch in its own material and area, not in the planting bed', () => {
    const mulch = mats.find((m) => m.id === 'mulch')!;
    expect(mulch.permeability).toBe(1);
    expect(mulch.category).toBe('loose');
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of fresh(seed).filter((x) => x.materialId === 'mulch')) {
        expect(e.type).toBe('gravel'); // the "gravel or mulch" area type
        expect(e.name).toBe('Mulch zone');
        found++;
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it('plants in beds, raised beds, mulch and gravel, but never on a lawn, patio, deck or path', () => {
    let inSoft = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = run(seed);
      const els = r.data.hardscape.filter((e) => !e.existing).map((e) => ({ e, poly: footprint(e, engine.hardscape) }));
      for (const inst of r.data.instances) {
        for (const { e, poly } of els) {
          const inside = pointInPolygon(inst.position[0], inst.position[1], poly);
          if (['lawn', 'patio', 'deck', 'path'].includes(e.type)) expect(inside, `a plant is on the ${e.name}`).toBe(false);
          else if (inside) inShared();
        }
      }
    }
    function inShared() { inSoft++; }
    expect(inSoft).toBeGreaterThan(50);
  });
});
