import { pairNeed } from '../src/engine/companions';
import { beforeAll, describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { generateConcept } from '../src/engine/concept';
import { circleOverlapsPolygon } from '../src/engine/geometry';
import { sunFit } from '../src/engine/growth';
import { footprint } from '../src/engine/hardscape';
import { buildSunMap, sunHoursAt, type SunMap } from '../src/engine/placement';
import { emptyScenarioData } from '../src/engine/scenario';
import { mulberry32, shuffleScenario } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, Material, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const spById = new Map(lib.species.map((s) => [s.id, s]));
let sunMap: SunMap;
const ctx = () => ({ site, structures, species: lib.species, materials: mats, engine, palette: emptyScenarioData(site).palette, sunMap });
const OPTS = { hardscape: true, plants: true, starredOnly: false };

beforeAll(() => {
  sunMap = buildSunMap(site, true, engine);
}, 60000);

describe('smart concepts', () => {
  it('see real differences in sun across the lot', () => {
    const vals = Array.from({ length: 40 }, (_, i) => sunHoursAt(sunMap, 5 + (i % 8) * 5, 5 + Math.floor(i / 8) * 25));
    expect(Math.max(...vals)).toBeGreaterThan(engine.growth.sunNeedHours.full.min);
    expect(Math.min(...vals)).toBeLessThan(engine.growth.sunNeedHours.full.min);
  });

  it('put every plant where its light need is met', () => {
    let planted = 0, shaded = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = generateConcept(ctx(), OPTS, mulberry32(seed));
      for (const i of r.data.instances) {
        const sp = spById.get(i.speciesId)!;
        planted++;
        const hours = sunHoursAt(sunMap, i.position[0], i.position[1]);
        expect(sunFit(sp, hours, engine.growth), `${sp.common} at ${i.position} gets ${hours.toFixed(1)} h`).toBe('ok');
        if (hours < engine.growth.sunNeedHours.full.min) { shaded++; expect(sp.sun).not.toBe('full'); }
      }
    }
    expect(planted).toBeGreaterThan(150);
    expect(shaded).toBeGreaterThan(0); // shady ground is used, by plants that like it
  });

  it('give every plant room at full size, trees included', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = generateConcept(ctx(), OPTS, mulberry32(seed));
      const ps = r.data.instances.map((i) => ({ i, sp: spById.get(i.speciesId)! }));
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
        const d = Math.hypot(ps[a].i.position[0] - ps[b].i.position[0], ps[a].i.position[1] - ps[b].i.position[1]);
        expect(d, `${ps[a].sp.common} and ${ps[b].sp.common}`).toBeGreaterThanOrEqual(pairNeed(ps[a].sp, ps[b].sp, engine.concept.plants.overlapAllowance, engine.concept.plants.companions).need - 1e-6);
      }
    }
  });

  it('never put a raised bed under a tree, now or at full size', () => {
    let beds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = generateConcept(ctx(), OPTS, mulberry32(seed));
      const raised = r.data.hardscape.filter((e) => e.type === 'raisedBed').map((e) => footprint(e, engine.hardscape));
      beds += raised.length;
      for (const i of r.data.instances) {
        const sp = spById.get(i.speciesId)!;
        if (sp.type !== 'tree') continue;
        for (const b of raised) expect(circleOverlapsPolygon(i.position[0], i.position[1], sp.matureWidth / 2, b), `${sp.common} over a raised bed`).toBe(false);
      }
      for (const t of site.contextObjects.filter((o) => o.kind === 'tree' && o.position)) {
        for (const b of raised) expect(circleOverlapsPolygon(t.position![0], t.position![1], (t.canopyWidth ?? 10) / 2, b)).toBe(false);
      }
    }
    expect(beds).toBeGreaterThan(10);
  });
});

describe('smart shuffles', () => {
  it('keep new plants in light they suit, with room, and trees off raised beds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const base = generateConcept(ctx(), OPTS, mulberry32(seed)).data;
      const r = shuffleScenario(base, { site, structures, species: lib.species, materials: mats, engine, sunMap }, { species: true, positions: true, materials: false, colors: false, time: false }, mulberry32(seed + 100));
      const raised = r.data.hardscape.filter((e) => e.type === 'raisedBed').map((e) => footprint(e, engine.hardscape));
      for (const i of r.data.instances) {
        const sp = spById.get(i.speciesId)!;
        expect(sunFit(sp, sunHoursAt(sunMap, i.position[0], i.position[1]), engine.growth), sp.common).toBe('ok');
        if (sp.type === 'tree') for (const b of raised) expect(circleOverlapsPolygon(i.position[0], i.position[1], sp.matureWidth / 2, b)).toBe(false);
      }
      const ps = r.data.instances.map((i) => ({ i, sp: spById.get(i.speciesId)! }));
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
        const d = Math.hypot(ps[a].i.position[0] - ps[b].i.position[0], ps[a].i.position[1] - ps[b].i.position[1]);
        expect(d, `${ps[a].sp.common} and ${ps[b].sp.common}`).toBeGreaterThanOrEqual(pairNeed(ps[a].sp, ps[b].sp, engine.concept.plants.overlapAllowance, engine.concept.plants.companions).need - 1e-6);
      }
    }
  });
});
