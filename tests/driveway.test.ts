import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { generateConcept } from '../src/engine/concept';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { drivewayBlocks, footprint } from '../src/engine/hardscape';
import { emptyScenarioData } from '../src/engine/scenario';
import { mulberry32, shuffleScenario } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });
const hs = engine.hardscape;
const driveway = (site.hardscape as HardscapeElement[]).find((e) => e.keepClear)!;
const poly = footprint(driveway, hs);
const buf = hs.drivewayBufferFt;

describe('nothing is planted on or beside the driveway', () => {
  it('keeps three feet clear of the driveway, on it and beside it', () => {
    expect(buf).toBe(3);
    const els = site.hardscape as HardscapeElement[];
    expect(drivewayBlocks([5, 30], els, hs)).toBe(true); // on it
    expect(drivewayBlocks([8.75 + 2.9, 30], els, hs)).toBe(true); // just under three feet from its edge
    expect(drivewayBlocks([8.75 + 3.1, 30], els, hs)).toBe(false); // just over
    expect(drivewayBlocks([0.5, 30], els, hs)).toBe(true); // the strip between it and the lot line
    expect(drivewayBlocks([30, 100], els, hs)).toBe(false); // the back yard
    expect(drivewayBlocks([5, 30], els.map((e) => (e.keepClear ? { ...e, removed: true } : e)), hs)).toBe(false); // gone in this scenario
  });

  it('refuses a plant placed on or near it, and allows one just past the buffer', () => {
    const s = makeAppStore('edit');
    expect(s.getState().addInstance('salvia-leucantha', [5, 30])).toBeNull();
    expect(s.getState().addInstance('salvia-leucantha', [10, 30])).toBeNull();
    expect(s.getState().addInstance('salvia-leucantha', [8.75 + 3.2, 30])).not.toBeNull();
    expect(s.getState().instances).toHaveLength(1);
  });

  it('does not let a plant be moved onto it, but lets one that is already there be moved off', () => {
    const s = makeAppStore('edit');
    const id = s.getState().addInstance('salvia-leucantha', [20, 30])!;
    s.getState().updateInstance(id, { position: [7, 30] });
    expect(s.getState().instances[0].position).toEqual([20, 30]);
    s.getState().updateInstance(id, { position: [22, 31] });
    expect(s.getState().instances[0].position).toEqual([22, 31]);
    // an old plan with a plant on the driveway can move it
    s.setState({ instances: [{ ...s.getState().instances[0], position: [5, 30] }] });
    s.getState().updateInstance(id, { position: [5.5, 30] }); // still blocked and the plant is blocked too: allowed so it can be dragged out
    expect(s.getState().instances[0].position).toEqual([5.5, 30]);
    s.getState().updateInstance(id, { position: [20, 30] });
    expect(s.getState().instances[0].position).toEqual([20, 30]);
  });

  it('keeps every plant in a generated concept at least three feet from the driveway', () => {
    const ctx = { site, structures, species: lib.species, materials: mats, engine, palette: emptyScenarioData(site).palette };
    let planted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = generateConcept(ctx, { hardscape: true, plants: true, starredOnly: false }, mulberry32(seed));
      for (const i of r.data.instances) {
        planted++;
        expect(pointInPolygon(i.position[0], i.position[1], poly), `seed ${seed}`).toBe(false);
        expect(distanceToPolygon(i.position[0], i.position[1], poly), `seed ${seed}`).toBeGreaterThanOrEqual(buf);
      }
    }
    expect(planted).toBeGreaterThan(300);
  });

  it('never nudges a plant onto it in a shuffle', () => {
    const ctx = { site, structures, species: lib.species, materials: mats, engine };
    // plants hugging the driveway's three-foot edge, with a big nudge
    const base = emptyScenarioData(site);
    base.instances = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, speciesId: 'salvia-leucantha', position: [8.75 + 3.2, 5 + i * 4] as [number, number], plantedMonth: 0, container: '5gal' as const, existing: false }));
    for (let seed = 1; seed <= 20; seed++) {
      const r = shuffleScenario(base, { ...ctx }, { species: false, positions: true, materials: false, colors: false, time: false }, mulberry32(seed));
      for (const i of r.data.instances) expect(distanceToPolygon(i.position[0], i.position[1], poly), `seed ${seed}`).toBeGreaterThanOrEqual(buf - 1e-9);
    }
  });
});
