import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import waterRaw from '../src/data/water.json';
import { placedPlants } from '../src/engine/growth';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { planIrrigation, type IrrigationInput, type IrrigationPlan } from '../src/engine/irrigation';
import { emptyScenarioData } from '../src/engine/scenario';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, PlantInstance, SpeciesLibrary, WaterConfig } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const water = waterRaw as unknown as WaterConfig;
const structures = activeStructures(site, { aduEnabled: true });
const cfg = engine.irrigation;

let n = 0;
const inst = (speciesId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: `i${n++}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false, ...over,
});
const bed = (id: string, x: number, y: number, s = 3): HardscapeElement => ({
  id, type: 'raisedBed', points: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], materialId: 'cedar', height: 1.5, depthIn: 0, width: 0, existing: false,
});

function plan(instances: PlantInstance[], extra: HardscapeElement[] = [], over: Partial<IrrigationInput> = {}, month = 120): IrrigationPlan {
  const base = emptyScenarioData(site);
  return planIrrigation({
    plants: placedPlants(instances, base.palette, lib.species, month, engine.growth),
    elements: [...base.hardscape, ...extra],
    structures,
    lot: site.lot,
    sources: site.irrigation!.sources,
    hydrozones: [],
    autoIrrigation: {},
    water,
    hardscapeCfg: engine.hardscape,
    soilFreeboardIn: 3,
    bedsOnDrip: false,
    cfg,
    ...over,
  });
}

// the earlier single hose bib behind the house, for tests about distance from one access
const ONE: { sources: IrrigationInput['sources'] } = { sources: [{ id: 'one', label: 'One', point: [28, 66.7] }] };

// back yard, open ground
const BACK: [number, number][] = [[30, 76], [38, 76], [30, 90], [38, 90], [30, 105], [38, 105]];

describe('irrigation layout', () => {
  it('has two flagged water accesses in the site data', () => {
    expect(site.irrigation?.sources.map((s) => s.id)).toEqual(['hose-bib-front', 'hose-bib-back']);
    expect(site.irrigation?.sources.every((s) => s.estimate)).toBe(true);
  });

  it('proposes drip emitters for shrubs, bubblers for trees and inline drip for groundcover', () => {
    const p = plan([inst('coleonema-pulchellum', 30, 76), inst('lagerstroemia-indica', 38, 90), inst('clinopodium-douglasii', 30, 105)]);
    const byLabel = Object.fromEntries(p.plants.map((r) => [r.id, r.method]));
    const methods = Object.values(byLabel).sort();
    expect(methods).toEqual(['bubbler', 'emitter', 'inline']);
    expect(p.totals.emitters).toBeGreaterThan(0);
    expect(p.totals.bubblers).toBeGreaterThan(0);
    expect(p.totals.inlineFt).toBeGreaterThan(0);
  });

  it('gives each hydrozone and device family its own valve', () => {
    const p = plan([
      inst('arctostaphylos-howard-mcminn', 30, 76), inst('salvia-leucantha', 38, 76),       // low, drip
      inst('coleonema-pulchellum', 30, 90),                                                // moderate, drip
      inst('lagerstroemia-indica', 38, 90),                                                // moderate, bubbler
    ]);
    const keys = p.valves.map((v) => `${v.hydrozoneId}|${v.family}`).sort();
    expect(keys).toEqual(['auto:low|drip', 'auto:moderate|bubbler', 'auto:moderate|drip']);
    expect(p.totals.zones).toBe(2);
    expect(p.totals.valves).toBe(3);
    expect(p.valves.every((v) => v.warning === null)).toBe(true);
  });

  it('splits a hydrozone onto more valves when the flow passes the limit', () => {
    const many = Array.from({ length: 14 }, (_, i) => inst('coleonema-pulchellum', 28 + (i % 4) * 5, 72 + Math.floor(i / 4) * 9, { existing: true, currentHeight: 5, currentWidth: 6 }));
    const small = { ...cfg, valveMaxGph: { ...cfg.valveMaxGph, drip: 60 } };
    const p = plan(many, [], { cfg: small });
    const mod = p.valves.filter((v) => v.hydrozoneId === 'auto:moderate' && v.family === 'drip');
    expect(mod.length).toBeGreaterThan(1);
    for (const v of mod) expect(v.gph).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('warns when a custom hydrozone mixes very different water needs on one valve', () => {
    const hz = [{ id: 'hz1', name: 'Mixed', irrigation: 'drip' as const }];
    const p = plan(
      [inst('eriogonum-fasciculatum', 30, 76, { hydrozoneId: 'hz1' }), inst('fragaria-seascape', 38, 76, { hydrozoneId: 'hz1' })],
      [], { hydrozones: hz },
    );
    expect(p.valves).toHaveLength(1);
    expect(p.valves[0].warning).toMatch(/Mixes/);
    expect(p.warnings.some((w) => w.severity === 'warn' && /Mixes/.test(w.text))).toBe(true);
  });

  it('leaves out plants in raised beds', () => {
    const inBed = inst('rosmarinus-officinalis', 37.5, 101.5);
    const outside = inst('rosmarinus-officinalis', 30, 90);
    const p = plan([inBed, outside], [bed('rb1', 36, 100)]);
    expect(p.excludedRaisedBed).toBe(1);
    expect(p.plants.map((r) => r.id)).toEqual([outside.id]);
    expect(p.valves.flatMap((v) => v.plantIds)).not.toContain(inBed.id);
    expect(p.valves.flatMap((v) => v.devices.map((d) => d.plantId))).not.toContain(inBed.id);
  });

  it('honors a hydrozone set to hand watering or none', () => {
    const hz = [{ id: 'h', name: 'Hand', irrigation: 'hand' as const }, { id: 'x', name: 'Dry', irrigation: 'none' as const }];
    const a = inst('coleonema-pulchellum', 30, 76, { hydrozoneId: 'h' });
    const b = inst('coleonema-pulchellum', 38, 76, { hydrozoneId: 'x' });
    const p = plan([a, b], [], { hydrozones: hz });
    expect(p.valves).toHaveLength(0);
    expect(p.plants.map((r) => r.method).sort()).toEqual(['hand', 'none']);
    expect(p.hand).toHaveLength(2);
  });

  it('waters a plant by hand when it is too far from any line', () => {
    const near = BACK.slice(0, 2).map(([x, y]) => inst('coleonema-pulchellum', x, y));
    const far = inst('coleonema-pulchellum', 40, 5);
    const p = plan([...near, far], [], ONE);
    const row = p.plants.find((r) => r.id === far.id)!;
    expect(row.method).toBe('hand');
    expect(row.reason).toMatch(/stands alone/);
    expect(p.warnings.some((w) => w.plantId === far.id)).toBe(true);
    expect(p.valves.flatMap((v) => v.plantIds)).not.toContain(far.id);
  });

  it('waters a branch by hand when it would run too far off an existing line', () => {
    const near = inst('coleonema-pulchellum', 30, 76);
    const off = inst('coleonema-pulchellum', 33, 112);
    const buddy = inst('coleonema-pulchellum', 33, 118); // not alone, so the lone-plant rule does not apply
    const p = plan([near, off, buddy], [], { cfg: { ...cfg, maxSpurFt: 10 } });
    expect(p.plants.filter((r) => r.method === 'hand').length).toBeGreaterThan(0);
    expect(p.plants.filter((r) => r.method === 'hand').every((r) => /limit for one branch/.test(r.reason ?? ''))).toBe(true);
  });

  it('adds spray heads for a lawn and none when the lawn is set to hand', () => {
    const lawn: HardscapeElement = { id: 'lawn1', type: 'lawn', points: [[28, 108], [46, 108], [46, 118], [28, 118]], materialId: 'turf', height: 0, depthIn: 0, width: 0, existing: false };
    const p = plan([], [lawn]);
    const v = p.valves.find((x) => x.hydrozoneId === 'auto:lawn');
    expect(v).toBeTruthy();
    expect(v!.family).toBe('spray');
    expect(v!.devices.length).toBeGreaterThan(1);
    for (const d of v!.devices) expect(pointInPolygon(d.at[0], d.at[1], lawn.points)).toBe(true);
    const q = plan([], [lawn], { autoIrrigation: { 'auto:lawn': 'hand' } });
    expect(q.valves).toHaveLength(0);
  });

  it('keeps every line off the buildings and inside the lot', () => {
    const p = plan([...BACK.map(([x, y]) => inst('coleonema-pulchellum', x, y)), inst('cercis-occidentalis', 20, 10), inst('lagerstroemia-indica', 40, 112)]);
    expect(p.valves.length).toBeGreaterThan(0);
    for (const v of p.valves) for (const r of v.runs) for (const pt of r.points) {
      expect(pt[0]).toBeGreaterThan(0);
      expect(pt[1]).toBeGreaterThan(0);
      expect(pt[0]).toBeLessThan(site.lot.width);
      expect(pt[1]).toBeLessThan(site.lot.depth);
      for (const s of structures) expect(pointInPolygon(pt[0], pt[1], s.footprint)).toBe(false);
    }
    // every point on a run segment (sampled) is clear of building walls
    for (const v of p.valves) for (const r of v.runs) for (let i = 1; i < r.points.length; i++) {
      const [a, b] = [r.points[i - 1], r.points[i]];
      for (let t = 0; t <= 1; t += 0.25) {
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        for (const s of structures) expect(distanceToPolygon(x, y, s.footprint) > 0.4 || !pointInPolygon(x, y, s.footprint)).toBe(true);
      }
    }
  });

  it('avoids raised beds and runs around them', () => {
    const wall = bed('rbw', 30, 80, 3);
    const p = plan([inst('coleonema-pulchellum', 36, 90)], [wall]);
    for (const v of p.valves) for (const r of v.runs) for (let i = 1; i < r.points.length; i++) {
      const [a, b] = [r.points[i - 1], r.points[i]];
      for (let t = 0; t <= 1; t += 0.1) expect(pointInPolygon(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, wall.points)).toBe(false);
    }
  });

  it('sizes lines by downstream flow: larger near the manifold, never smaller upstream', () => {
    const p = plan(Array.from({ length: 10 }, (_, i) => inst('coleonema-pulchellum', 26 + (i % 5) * 4, 72 + Math.floor(i / 5) * 12, { existing: true, currentHeight: 5, currentWidth: 6 })));
    for (const v of p.valves) {
      const sizes = v.runs.map((r) => r.sizeInches);
      expect(Math.max(...sizes)).toBeGreaterThanOrEqual(Math.min(...sizes));
      // line length by size adds up to the runs
      const total = v.runs.reduce((a, r) => a + r.points.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - r.points[i - 1][0], q[1] - r.points[i - 1][1]) : 0), 0), 0);
      expect(Object.values(v.linesFt).reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
    }
    expect(p.totals.linesFt).toBeTruthy();
  });

  it('reaches every attached tap from the manifold', () => {
    const p = plan(BACK.map(([x, y]) => inst('coleonema-pulchellum', x, y)), [], ONE);
    const v = p.valves[0];
    // every plant on the valve has a device, and its tap lies on a run or is the manifold
    const onRun = (q: [number, number]) => v.runs.some((r) => r.points.some((pt) => Math.hypot(pt[0] - q[0], pt[1] - q[1]) < 0.01));
    for (const t of v.tails) expect(onRun(t.from) || p.sources.some((sp) => Math.hypot(t.from[0] - sp.manifold[0], t.from[1] - sp.manifold[1]) < 0.01)).toBe(true);
    expect(v.longestRunFt).toBeGreaterThan(0);
  });

  it('updates as plants are added and removed, and is deterministic', () => {
    const a = inst('coleonema-pulchellum', 30, 76);
    const b = inst('coleonema-pulchellum', 38, 90);
    const one = plan([a]);
    const two = plan([a, b]);
    expect(two.totals.emitters).toBeGreaterThan(one.totals.emitters);
    expect(two.totals.linesFt['0.5']).toBeGreaterThan(one.totals.linesFt['0.5'] ?? 0);
    expect(JSON.stringify(plan([a, b]))).toBe(JSON.stringify(two));
    const moved = plan([a, { ...b, position: [38, 112] }]);
    expect(JSON.stringify(moved)).not.toBe(JSON.stringify(two));
    expect(plan([]).valves).toHaveLength(0);
  });

  it('lists a parts list whose total matches the cost, flagged as stand-in prices', () => {
    const p = plan(BACK.map(([x, y]) => inst('lagerstroemia-indica', x, y)));
    expect(cfg.prices.status).toBe('stand-in');
    expect(p.parts.length).toBeGreaterThan(3);
    expect(p.cost).toBeCloseTo(p.parts.reduce((a, r) => a + r.total, 0), 6);
    expect(p.parts.find((r) => r.id === 'valve')!.quantity).toBe(p.totals.valves);
  });
});

describe('raised beds on drip or by hand', () => {
  const drip = bed;
  const planOn = (i: PlantInstance[], e: HardscapeElement[]) => plan(i, e, { bedsOnDrip: true });

  it('leaves beds to hand watering unless raised beds are switched onto drip', () => {
    const p = plan([], [bed('rb1', 34, 100)]);
    expect(p.beds).toHaveLength(1);
    expect(p.beds[0].method).toBe('hand');
    expect(p.valves).toHaveLength(0);
  });

  it('puts emitters in a drip bed, at the soil surface and inside its walls', () => {
    const b = drip('rb2', 34, 100, 6);
    const p = planOn([], [b]);
    expect(p.valves).toHaveLength(1);
    const v = p.valves[0];
    expect(v.bedIds).toEqual(['rb2']);
    expect(v.devices.length).toBeGreaterThanOrEqual(25); // about every foot in a 6 by 6
    for (const d of v.devices) {
      expect(d.at[0]).toBeGreaterThan(34 + cfg.bed.edgeInsetFt - 1e-6);
      expect(d.at[0]).toBeLessThan(40 - cfg.bed.edgeInsetFt + 1e-6);
      expect(d.at[1]).toBeGreaterThan(100 + cfg.bed.edgeInsetFt - 1e-6);
      expect(d.at[1]).toBeLessThan(106 - cfg.bed.edgeInsetFt + 1e-6);
      expect(d.z).toBeCloseTo(1.5 - 3 / 12, 5);
    }
    expect(p.beds[0].method).toBe('emitter');
    expect(p.beds[0].valveId).toBe(v.id);
    expect(p.totals.emitters).toBe(v.devices.length);
  });

  it('runs a line that stops outside the bed', () => {
    const p = planOn([], [drip('rb3', 34, 100)]);
    const v = p.valves[0];
    const inside = (x: number, y: number) => x > 34 && x < 37 && y > 100 && y < 103;
    for (const r of v.runs) for (const q of r.points) expect(inside(q[0], q[1])).toBe(false);
    expect(v.longestRunFt).toBeGreaterThan(0);
  });

  it('shares one valve between several drip beds and counts them in the parts list', () => {
    const p = planOn([], [drip('a', 34, 100), drip('b', 30, 80)]);
    expect(p.valves).toHaveLength(1);
    expect(p.valves[0].bedIds.sort()).toEqual(['a', 'b']);
    expect(p.parts.some((r) => r.id === 'emitter')).toBe(true);
  });

  it('keeps plants in a hand-watered bed out of the layout, and out of the hand list', () => {
    const inBed = inst('salvia-leucantha', 35.5, 101.5);
    const p = plan([inBed], [bed('rb4', 34, 100)]);
    expect(p.excludedRaisedBed).toBe(1);
    expect(p.hand).toHaveLength(0);
  });
});

describe('two water accesses', () => {
  const front = site.irrigation!.sources[0], back = site.irrigation!.sources[1];

  it('puts the front access at the middle of the front of the house and the back one at the middle of the back of the garage', () => {
    const house = site.structures.filter((st) => st.group === 'house').flatMap((st) => st.footprint);
    const xs = house.map((q) => q[0]), ys = house.map((q) => q[1]);
    expect(front.point[0]).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 1);
    expect(front.point[1]).toBeCloseTo(Math.min(...ys), 1);
    const garage = site.structures.find((st) => st.id === 'garage')!.footprint;
    const gx = garage.map((q) => q[0]), gy = garage.map((q) => q[1]);
    expect(back.point[0]).toBeCloseTo((Math.min(...gx) + Math.max(...gx)) / 2, 1);
    expect(back.point[1]).toBeCloseTo(Math.max(...gy), 1);
  });

  it('serves a front yard plant from the front access and a back yard plant from the back one', () => {
    const f = inst('coleonema-pulchellum', 30, 12), b = inst('coleonema-pulchellum', 30, 110);
    const p = plan([f, b]);
    expect(p.valves).toHaveLength(2);
    const of = (id: string) => p.valves.find((v) => v.plantIds.includes(id))!;
    expect(of(f.id).sourceId).toBe('hose-bib-front');
    expect(of(b.id).sourceId).toBe('hose-bib-back');
    expect(p.supplies.map((s) => s.sourceId).sort()).toEqual(['hose-bib-back', 'hose-bib-front']);
    // each manifold stands next to its own access
    for (const s of p.sources) expect(Math.hypot(s.manifold[0] - s.point[0], s.manifold[1] - s.point[1])).toBeLessThan(6);
  });

  it('keeps each valve to the plants of one access, and shares nothing between them', () => {
    const p = plan([inst('coleonema-pulchellum', 30, 12), inst('coleonema-pulchellum', 36, 14), inst('coleonema-pulchellum', 30, 110), inst('coleonema-pulchellum', 36, 112)]);
    expect(p.valves.map((v) => v.sourceId).sort()).toEqual(['hose-bib-back', 'hose-bib-front']);
    for (const v of p.valves) expect(v.plantIds).toHaveLength(2);
    expect(p.sources.find((s) => s.id === 'hose-bib-front')!.valveIds).toHaveLength(1);
  });

  it('counts a backflow preventer for each access', () => {
    const p = plan([inst('coleonema-pulchellum', 30, 12), inst('coleonema-pulchellum', 30, 110)]);
    expect(p.parts.find((r) => r.id === 'backflow')!.quantity).toBe(2);
  });
});

describe('valve labels', () => {
  const near = (p: [number, number], pts: [number, number][]) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
    }
    return best;
  };

  it('puts each label on one of its own valve lines', () => {
    const p = plan([inst('coleonema-pulchellum', 30, 12), inst('salvia-leucantha', 38, 20), inst('coleonema-pulchellum', 30, 90), inst('arctostaphylos-howard-mcminn', 38, 100)]);
    expect(p.valves.length).toBeGreaterThan(1);
    for (const v of p.valves) {
      expect(v.runs.length).toBeGreaterThan(0);
      expect(Math.min(...v.runs.map((r) => near(v.labelAt, r.points)))).toBeLessThan(0.01);
    }
  });

  it('keeps labels apart when the lines allow it', () => {
    const p = plan(BACK.map(([x, y], i) => inst(i % 2 ? 'salvia-leucantha' : 'coleonema-pulchellum', x, y)));
    for (let i = 0; i < p.valves.length; i++) for (let j = i + 1; j < p.valves.length; j++) {
      const a = p.valves[i].labelAt, b = p.valves[j].labelAt;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0.5);
    }
  });
});
