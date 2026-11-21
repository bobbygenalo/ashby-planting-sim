import { beforeAll, describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { detectConflicts, type ContextTree } from '../src/engine/conflicts';
import { placedPlants } from '../src/engine/growth';
import { buildSunScene, loadSite } from '../src/engine/site';
import { computeSunHours, type SunHoursResult } from '../src/engine/sunhours';
import { explainCell, rescore, sunTerm, suggestPlacements, type SuggestInput } from '../src/engine/suggest';
import type { EngineConfig, HardscapeElement, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const site = loadSite(siteRaw);
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const zone = (id: string) => site.zones.find((z) => z.id === id)!;
const ctxTrees: ContextTree[] = site.contextObjects
  .filter((o) => o.kind === 'tree' && o.position)
  .map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], height: o.height, width: o.canopyWidth ?? 10 }));

let sun: SunHoursResult;
beforeAll(() => {
  const g = engine.sun.seasons.find((s) => s.id === 'growing')!;
  sun = computeSunHours(buildSunScene(site, { aduEnabled: true }, engine), { period: { kind: 'range', from: g.from, to: g.to }, year: 2026, config: { ...engine.sun, sampleEveryDays: 21 } });
});

let n = 0;
const inst = (speciesId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: `s${n++}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false, ...over,
});
const placed = (list: PlantInstance[]) => placedPlants(list, Object.fromEntries(lib.species.map((s) => [s.id, true])), lib.species, 0, engine.growth);

const input = (speciesId: string, zoneId: string, over: Partial<SuggestInput> = {}): SuggestInput => ({
  species: sp(speciesId), zone: zone(zoneId), sun, structures: site.structures, plants: [], elements: site.hardscape,
  easements: site.easements, contextTrees: ctxTrees, lot: site.lot, weights: engine.suggest.weights, cfg: engine, ...over,
});

describe('placement scoring (GR-7)', () => {
  it('scores a 1 ft grid in the chosen zone and returns up to five separated, ranked locations', () => {
    const r = suggestPlacements(input('salvia-clevelandii', 'back_yard'));
    expect(r.cells.length).toBeGreaterThan(3000);
    for (const c of r.cells) {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(1);
    }
    expect(r.top.length).toBe(engine.suggest.topCount);
    for (let i = 1; i < r.top.length; i++) expect(r.top[i].total).toBeLessThanOrEqual(r.top[i - 1].total);
    for (let i = 0; i < r.top.length; i++) {
      for (let j = i + 1; j < r.top.length; j++) {
        expect(Math.hypot(r.top[i].x - r.top[j].x, r.top[i].y - r.top[j].y)).toBeGreaterThanOrEqual(engine.suggest.minSeparationFt);
      }
    }
    expect(r.top.every((c) => !c.excluded && pointInZone(c.x, c.y, 'back_yard'))).toBe(true);
    expect(r.grid.total.length).toBe(r.grid.nx * r.grid.ny);
  });

  it('M6 acceptance: every suggested cell explains its score, and the explanation adds up', () => {
    const species = sp('salvia-clevelandii');
    const r = suggestPlacements(input(species.id, 'back_yard'));
    for (const c of r.top) {
      const ex = explainCell(c, species, r.weights, engine);
      expect(ex.map((e) => e.term)).toEqual(['sun', 'clearance', 'hydrozone']);
      expect(ex.every((e) => e.text.length > 10)).toBe(true);
      expect(ex.reduce((a, e) => a + e.contribution, 0)).toBeCloseTo(c.total, 9);
      expect(ex[0].text).toContain('h of sun');
    }
  });

  it('excludes structures, paving and the driveway, easement height cap, and existing root zones', () => {
    const r = suggestPlacements(input('cercis-occidentalis', 'back_yard'));
    const at = (x: number, y: number) => r.cells.find((c) => Math.abs(c.x - x) < 0.51 && Math.abs(c.y - y) < 0.51)!;
    expect(at(10, 95).excluded).toBe('structure'); // garage
    expect(at(30, 135).excluded).toBe('structure'); // ADU
    expect(at(4, 72).excluded).toBe('paving'); // driveway
    expect(at(4, 148).excluded).toBe('easement'); // 15 ft redbud under a 15 ft cap
    expect(at(14, 126).excluded).toBe('root-zone'); // inside the mature ficus's root zone
    expect(at(30, 100).excluded).toBeNull();
    // A shorter plant is fine in the easement.
    const low = suggestPlacements(input('salvia-clevelandii', 'back_yard'));
    expect(low.cells.find((c) => Math.abs(c.x - 4) < 0.51 && Math.abs(c.y - 148) < 0.51 && c.excluded === 'easement')).toBeUndefined();
    expect(r.excludedCount).toBeGreaterThan(500);
  });

  it('penalizes a cell too close to a building at maturity and explains which one', () => {
    const species = sp('cercis-occidentalis');
    const r = suggestPlacements(input(species.id, 'back_yard'));
    const near = r.cells.find((c) => Math.abs(c.x - 10) < 0.51 && Math.abs(c.y - 79.5) < 0.51)!; // ~3 ft from the garage
    const open = r.cells.find((c) => Math.abs(c.x - 38) < 0.51 && Math.abs(c.y - 100) < 0.51)!; // far from every building and line
    expect(near.terms.clearance).toBeLessThan(0.5);
    expect(open.terms.clearance).toBe(1);
    expect(near.detail.margin!).toBeLessThan(0);
    expect(explainCell(near, species, r.weights, engine)[1].text).toContain('short of the clearance');
    expect(explainCell(near, species, r.weights, engine)[1].text).toMatch(/Garage|House|ADU/);
  });

  it('breaks ties toward the cell with the most room to spare', () => {
    const r = suggestPlacements(input('salvia-clevelandii', 'back_yard'));
    const best = Math.max(...r.cells.filter((c) => !c.excluded).map((c) => c.total));
    const tied = r.cells.filter((c) => !c.excluded && c.total >= best - 1e-9);
    expect(tied.length).toBeGreaterThan(50); // many cells are simply fine
    const mostRoom = Math.max(...tied.map((c) => c.detail.margin ?? Infinity));
    expect(r.top[0].detail.margin).toBe(mostRoom);
    expect(r.top[0].detail.margin!).toBeGreaterThan(2);
  });

  it('adjustable weights change scores, and rescoring matches a fresh run', () => {
    const species = sp('salvia-clevelandii');
    const base = suggestPlacements(input(species.id, 'back_yard'));
    const sunOnly = { sun: 1, clearance: 0, hydrozone: 0 };
    const clearOnly = { sun: 0, clearance: 1, hydrozone: 0 };
    const a = rescore(base, sunOnly, species, engine, site.lot);
    const b = rescore(base, clearOnly, species, engine, site.lot);
    // The best cell under each weighting is best at that one term.
    expect(a.top[0].terms.sun).toBe(Math.max(...base.cells.filter((c) => !c.excluded).map((c) => c.terms.sun)));
    expect(b.top[0].terms.clearance).toBe(1);
    // A shady cell with room to spare scores low when sun is all that counts, and perfectly when only room counts.
    const shady = base.cells.find((c) => !c.excluded && c.terms.sun < 0.8 && c.terms.clearance === 1)!;
    expect(shady).toBeDefined();
    const at = (r: typeof a) => r.cells.find((c) => c.x === shady.x && c.y === shady.y)!.total;
    expect(at(a)).toBeLessThan(0.8);
    expect(at(b)).toBe(1);
    // Rescoring gives the same ranking and scores as measuring again with those weights.
    const fresh = suggestPlacements(input(species.id, 'back_yard', { weights: sunOnly }));
    expect(a.top.map((c) => `${c.x},${c.y},${c.total.toFixed(6)}`)).toEqual(fresh.top.map((c) => `${c.x},${c.y},${c.total.toFixed(6)}`));
    // Zero weights everywhere gives zero scores, not NaN.
    expect(rescore(base, { sun: 0, clearance: 0, hydrozone: 0 }, species, engine, site.lot).cells.every((c) => c.total === 0)).toBe(true);
  });

  it('the best cells hold up: planting there produces no conflicts at any age', () => {
    for (const id of ['salvia-clevelandii', 'ceanothus-concha', 'cercis-occidentalis']) {
      const species = sp(id);
      const r = suggestPlacements(input(id, 'back_yard'));
      const best = r.top[0];
      expect(best.terms.clearance, id).toBe(1);
      const planted = inst(id, best.x, best.y);
      const all = detectConflicts({
        instances: [planted], palette: { [id]: true }, species: lib.species, structures: site.structures,
        elements: site.hardscape, easements: site.easements, contextTrees: ctxTrees, lot: site.lot, cfg: engine, maxMonths: 360,
      });
      // The placeholder site trees have their own conflicts with the ADU; only this plant's matter here.
      const mine = all.filter((c) => c.instanceIds.includes(planted.id));
      expect(mine.map((c) => c.message), `${species.common} at ${best.x},${best.y}`).toEqual([]);
    }
  });

  it('scores hydrozone match from neighbors within reach', () => {
    const species = sp('salvia-bees-bliss'); // very low water
    const alone = suggestPlacements(input(species.id, 'back_yard'));
    const cell = alone.cells.find((c) => Math.abs(c.x - 40) < 0.51 && Math.abs(c.y - 100) < 0.51)!;
    expect(cell.terms.hydrozone).toBe(1);
    expect(cell.detail.neighbors).toBe(0);
    const thirsty = placed([inst('polygala-myrtifolia', 42, 100, { existing: true, currentHeight: 5, currentWidth: 5 })]); // moderate, 2 steps away
    const near = suggestPlacements(input(species.id, 'back_yard', { plants: thirsty }));
    const c2 = near.cells.find((c) => Math.abs(c.x - 40) < 0.51 && Math.abs(c.y - 100) < 0.51)!;
    expect(c2.terms.hydrozone).toBe(0);
    expect(c2.detail.waterStepGap).toBe(2);
    const friend = placed([inst('salvia-mellifera', 42, 100, { existing: true, currentHeight: 5, currentWidth: 5 })]); // same category
    const c3 = suggestPlacements(input(species.id, 'back_yard', { plants: friend })).cells.find((c) => Math.abs(c.x - 40) < 0.51 && Math.abs(c.y - 100) < 0.51)!;
    expect(c3.terms.hydrozone).toBe(1);
  });

  it('avoids crowding other plants at maturity, except understory beneath them', () => {
    const shrub = placed([inst('ceanothus-concha', 40, 100, { existing: true, currentHeight: 6, currentWidth: 6 })]);
    const same = suggestPlacements(input('ceanothus-concha', 'back_yard', { plants: shrub }));
    expect(same.cells.find((c) => Math.abs(c.x - 42) < 0.51 && Math.abs(c.y - 100) < 0.51)!.terms.clearance).toBeLessThan(1);
    const under = suggestPlacements(input('salvia-bees-bliss', 'back_yard', { plants: shrub }));
    expect(under.cells.find((c) => Math.abs(c.x - 42) < 0.51 && Math.abs(c.y - 100) < 0.51)!.terms.clearance).toBe(1);
  });

  it('works for a different yard zone, and reports hard exclusions in the front yard too', () => {
    const r = suggestPlacements(input('lavandula-stoechas', 'front_yard'));
    expect(r.zoneId).toBe('front_yard');
    expect(r.top.length).toBeGreaterThan(0);
    expect(r.top.every((c) => c.x >= 8 && c.y <= 24)).toBe(true);
    expect(r.top[0].detail.sunHours).toBeGreaterThan(6); // front yard faces the sun
  });
});

describe('sun term', () => {
  it('rates sun hours against the light need', () => {
    expect(sunTerm(sp('salvia-clevelandii'), 9, engine.growth)).toBe(1);
    expect(sunTerm(sp('salvia-clevelandii'), 3, engine.growth)).toBeCloseTo(0.5, 9);
    expect(sunTerm(sp('heuchera-maxima'), 5, engine.growth)).toBe(1);
    expect(sunTerm(sp('heuchera-maxima'), 2, engine.growth)).toBeLessThan(1);
    expect(sunTerm(sp('heuchera-maxima'), 11, engine.growth)).toBeLessThan(1);
    const shade = { ...sp('salvia-spathacea'), sun: 'shade' as const };
    expect(sunTerm(shade, 2, engine.growth)).toBe(1);
    expect(sunTerm(shade, 4.5, engine.growth)).toBe(1);
    expect(sunTerm(shade, 9.5, engine.growth)).toBeCloseTo(0, 9);
  });
});

function pointInZone(x: number, y: number, id: string) {
  const p = zone(id).polygon;
  return x >= Math.min(...p.map((q) => q[0])) && x <= Math.max(...p.map((q) => q[0])) && y >= Math.min(...p.map((q) => q[1])) && y <= Math.max(...p.map((q) => q[1]));
}
void ({} as HardscapeElement);
