import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import soilRaw from '../src/data/soil.json';
import speciesRaw from '../src/data/species.json';
import waterRaw from '../src/data/water.json';
import { buildAssumptions, placeholders } from '../src/engine/assumptions';
import { placedPlants } from '../src/engine/growth';
import { bloomCalendar, gapSuggestions, pollinatorSummary, pollinatorWarnings } from '../src/engine/pollinator';
import { plantSchedule, scheduleCsv } from '../src/engine/schedule';
import { loadSite } from '../src/engine/site';
import {
  drainageClass, plantingHole, raisedBedFill, soilMismatches, soilQuantities, treeSoilVolumes,
} from '../src/engine/soil';
import type { EngineConfig, HardscapeElement, Hydrozone, Material, PlantInstance, SoilConfig, SoilProfile, SpeciesLibrary, WaterConfig } from '../src/engine/types';
import {
  establishmentMultiplier, hydrozoneMixWarning, hydrozoneOf, monthlyGallons, waterBudget, waterDemand,
} from '../src/engine/water';

const engine = engineRaw as unknown as EngineConfig;
const water = waterRaw as unknown as WaterConfig;
const soil = soilRaw as unknown as SoilConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const site = loadSite(siteRaw);
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const inst = (speciesId: string, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: `i${Math.random().toString(36).slice(2, 7)}`, speciesId, position: [30, 90], plantedMonth: 0, container: '5gal', existing: false, ...over,
});
const placed = (list: PlantInstance[], month = 0) =>
  placedPlants(list, Object.fromEntries(lib.species.map((s) => [s.id, true])), lib.species, month, engine.growth);

const demand = (plants: ReturnType<typeof placed>, over: Partial<Parameters<typeof waterDemand>[0]> = {}) =>
  waterDemand({
    plants, lawns: [], hydrozones: [], autoIrrigation: {}, zones: site.zones, timelineMonth: 0, water, growth: engine.growth,
    hardscapeCfg: engine.hardscape, useRain: false, ...over,
  });

describe('M5 acceptance: water demand matches a hand calculation within 1%', () => {
  it('hand-worked: a 100 sq ft zone of low-water plants on drip in June', () => {
    // ETo 5.7 in (June config) x 0.62 gal per sq ft per in x PF 0.2 x 100 sq ft / IE 0.81
    const handJune = (water.eto.monthly[5] * 0.62 * 0.2 * 100) / 0.81;
    const g = monthlyGallons({ eto: water.eto.monthly, rain: null, plantFactor: 0.2, areaSf: 100, efficiency: 0.81, conversion: water.formula.conversion });
    expect(Math.abs(g[5] / handJune - 1)).toBeLessThan(0.01);
    expect(g[5]).toBeCloseTo(handJune, 6);
    const handAnnual = (water.eto.monthly.reduce((a, b) => a + b, 0) * 0.62 * 0.2 * 100) / 0.81;
    expect(Math.abs(g.reduce((a, b) => a + b, 0) / handAnnual - 1)).toBeLessThan(0.01);
  });

  it('the engine reproduces the hand calculation for a real mature plant on a hydrozone', () => {
    const s = sp('salvia-leucantha'); // low water, 5 ft wide
    const p = placed([inst(s.id, { existing: true, currentHeight: 4, currentWidth: 5 })]);
    const d = demand(p);
    const area = Math.PI * 2.5 ** 2;
    const hand = (water.eto.monthly[6] * 0.62 * 0.2 * area) / 0.81;
    expect(Math.abs(d.rows[0].monthlyGal[6] / hand - 1)).toBeLessThan(0.01);
    expect(d.hydrozones[0].monthlyGal[6]).toBeCloseTo(d.rows[0].monthlyGal[6], 9);
    expect(d.lot.annualGal).toBeCloseTo(d.rows[0].annualGal, 9);
  });
});

describe('water model details', () => {
  it('uses the verified MWELO constants', () => {
    expect(water.formula.conversion).toBe(0.62);
    expect(water.irrigation.drip.efficiency).toBe(0.81);
    expect(water.irrigation.spray.efficiency).toBe(0.75);
    expect(water.budget.etaf).toBe(0.55);
    expect(water.rainfall.monthly.reduce((a, b) => a + b, 0)).toBeCloseTo(14.25, 2);
    for (const [cat, pf] of Object.entries(engine.growth.wucolsPlantFactor)) {
      const [lo, hi] = water.plantFactorRanges[cat];
      expect(pf).toBeGreaterThanOrEqual(lo);
      expect(pf).toBeLessThanOrEqual(hi);
    }
  });

  it('flags the ETo table as an unverified placeholder', () => {
    expect(water.eto.status).toBe('unverified');
    const ph = placeholders(buildAssumptions({ engine, water, soil, site, library: lib }));
    expect(ph.some((i) => i.label.includes('ETo'))).toBe(true);
  });

  it('applies the establishment multiplier for the configured period, then drops it', () => {
    const s = sp('ceanothus-concha');
    const i = inst(s.id, { plantedMonth: 0 });
    expect(establishmentMultiplier(i, s.type, 0, water)).toBe(water.establishment.shrub.multiplier);
    expect(establishmentMultiplier(i, s.type, water.establishment.shrub.months - 1, water)).toBe(water.establishment.shrub.multiplier);
    expect(establishmentMultiplier(i, s.type, water.establishment.shrub.months, water)).toBe(1);
    expect(establishmentMultiplier({ ...i, existing: true }, s.type, 0, water)).toBe(1);
  });

  it('subtracts effective rainfall without going below zero', () => {
    const base = { eto: water.eto.monthly, plantFactor: 0.5, areaSf: 50, efficiency: 0.81, conversion: 0.62 };
    const dry = monthlyGallons({ ...base, rain: null });
    const rain = water.rainfall.monthly.map((r) => r * water.rainfall.effectiveFraction);
    const wet = monthlyGallons({ ...base, rain });
    wet.forEach((g, m) => {
      expect(g).toBeLessThanOrEqual(dry[m] + 1e-9);
      expect(g).toBeGreaterThanOrEqual(0);
    });
    expect(wet[0]).toBe(0); // January rain exceeds the need
    expect(wet[7]).toBeCloseTo(dry[7], 6); // August is dry
  });

  it('no irrigation means no applied water', () => {
    const g = monthlyGallons({ eto: water.eto.monthly, rain: null, plantFactor: 0.5, areaSf: 50, efficiency: 0, conversion: 0.62 });
    expect(g.every((v) => v === 0)).toBe(true);
  });

  it('groups plants into automatic hydrozones by category, with explicit zones overriding', () => {
    const a = inst('salvia-leucantha'), b = inst('salvia-bees-bliss'), c = inst('polygala-myrtifolia');
    const d = demand(placed([a, b, c]));
    expect(d.hydrozones.map((h) => h.id).sort()).toEqual(['auto:low', 'auto:moderate', 'auto:very low']);
    const hz: Hydrozone[] = [{ id: 'z1', name: 'Front beds', irrigation: 'spray' }];
    const d2 = demand(placed([{ ...a, hydrozoneId: 'z1' }, b, c]), { hydrozones: hz });
    const z1 = d2.hydrozones.find((h) => h.id === 'z1')!;
    expect(z1.irrigation).toBe('spray');
    expect(z1.efficiency).toBe(0.75);
    expect(z1.members).toBe(1);
    const resolved = hydrozoneOf({ ...a, hydrozoneId: 'z1' }, sp(a.speciesId), hz, {}, water);
    expect(resolved.auto).toBe(false);
  });

  it('warns when non-adjacent water-use categories share a hydrozone (WS-4)', () => {
    expect(hydrozoneMixWarning(['low', 'moderate'])).toBeNull();
    expect(hydrozoneMixWarning(['very low', 'low'])).toBeNull();
    expect(hydrozoneMixWarning(['very low', 'moderate'])).toContain('Mixes');
    const hz: Hydrozone[] = [{ id: 'z1', name: 'Mixed', irrigation: 'drip' }];
    const d = demand(placed([inst('salvia-bees-bliss', { hydrozoneId: 'z1' }), inst('polygala-myrtifolia', { hydrozoneId: 'z1' })]), { hydrozones: hz });
    expect(d.hydrozones.find((h) => h.id === 'z1')!.warning).not.toBeNull();
  });

  it('spreads each month over its weeks and reports inches per week (WS-6)', () => {
    const s = sp('salvia-leucantha');
    const d = demand(placed([inst(s.id, { existing: true, currentHeight: 4, currentWidth: 5 })]));
    const h = d.hydrozones[0];
    expect(h.weeklyGal[6]).toBeCloseTo((h.monthlyGal[6] * 7) / 31, 9);
    const area = Math.PI * 2.5 ** 2;
    expect(h.weeklyInches[6]).toBeCloseTo(h.weeklyGal[6] / (0.62 * area), 9);
    // Applied depth per week at the peak is roughly the weekly crop need divided by efficiency.
    expect(h.weeklyInches[6]).toBeCloseTo(((water.eto.monthly[6] * 0.2) / 0.81) * (7 / 31), 6);
  });

  it('rolls up per yard zone and lot, and counts lawn', () => {
    const back = inst('salvia-leucantha', { position: [30, 90], existing: true, currentHeight: 4, currentWidth: 5 });
    const front = inst('salvia-leucantha', { position: [30, 10], existing: true, currentHeight: 4, currentWidth: 5 });
    const lawn: HardscapeElement = { id: 'l1', type: 'lawn', points: [[10, 2], [20, 2], [20, 12], [10, 12]], materialId: 'lawn', height: 0, depthIn: 4, width: 0, existing: false };
    const d = demand(placed([back, front]), { lawns: [lawn] });
    expect(d.yardZones.find((z) => z.id === 'back_yard')!.annualGal).toBeCloseTo(d.rows.find((r) => r.id === back.id)!.annualGal, 6);
    const lawnRow = d.rows.find((r) => r.kind === 'lawn')!;
    expect(lawnRow.areaSf).toBeCloseTo(100, 6);
    expect(lawnRow.annualGal).toBeCloseTo((water.eto.monthly.reduce((a, b) => a + b, 0) * 0.62 * 0.8 * 100) / 0.75, 4);
    expect(d.lot.annualGal).toBeCloseTo(d.rows.reduce((a, r) => a + r.annualGal, 0), 6);
    expect(d.hydrozones.some((h) => h.id === 'auto:lawn')).toBe(true);
  });

  it('computes an informational budget from landscape area (WS-7)', () => {
    const lawn: HardscapeElement = { id: 'l1', type: 'lawn', points: [[10, 2], [20, 2], [20, 12], [10, 12]], materialId: 'lawn', height: 0, depthIn: 4, width: 0, existing: false };
    const b = waterBudget({ plants: [], elements: [lawn], water, hardscapeCfg: engine.hardscape, annualDemandGal: 5000 });
    expect(b.landscapeAreaSf).toBeCloseTo(100, 6);
    expect(b.annualAllowanceGal).toBeCloseTo(water.eto.monthly.reduce((a, c) => a + c, 0) * 0.62 * 0.55 * 100, 6);
    expect(b.ratio).toBeCloseTo(5000 / b.annualAllowanceGal, 9);
  });
});

describe('soil (WS-10 to WS-14)', () => {
  const profile = (over: Partial<SoilProfile>): SoilProfile => ({ ...soil.defaultProfile, ...over });

  it('classifies drainage by percolation rate', () => {
    expect(drainageClass(3, soil)).toBe('fast');
    expect(drainageClass(1, soil)).toBe('moderate');
    expect(drainageClass(0.2, soil)).toBe('slow');
  });

  it('flags drainage, texture and pH mismatches (WS-11)', () => {
    const clev = sp('salvia-clevelandii'); // needs fast drainage
    expect(soilMismatches(clev, profile({ drainageInHr: 0.2, texture: 'clay' }), soil).length).toBeGreaterThanOrEqual(2);
    expect(soilMismatches(clev, profile({ drainageInHr: 3, texture: 'sandy loam' }), soil)).toEqual([]);
    const lor = sp('loropetalum-chinense'); // acid soil
    expect(soilMismatches(lor, profile({ ph: 8 }), soil).some((m) => m.includes('pH'))).toBe(true);
    expect(soilMismatches(lor, profile({ ph: 6 }), soil)).toEqual([]);
    // The default profile (loam, 1 in/hr, pH 7) suits a moderate-drainage plant.
    expect(soilMismatches(sp('salvia-leucantha'), soil.defaultProfile, soil)).toEqual([]);
  });

  it('sizes planting holes from the container (WS-12)', () => {
    const h = plantingHole('5gal', soil);
    expect(h.widthIn).toBe(22);
    expect(h.depthIn).toBe(10);
    expect(h.volumeCuFt).toBeCloseTo((Math.PI * 11 ** 2 * 10) / 1728, 9);
    expect(plantingHole('24box', soil).volumeCuFt).toBeGreaterThan(plantingHole('1gal', soil).volumeCuFt * 10);
  });

  it('totals excavation, amendment and mulch per bed and for the scenario', () => {
    const bed: HardscapeElement = { id: 'b1', type: 'bed', points: [[28, 72], [42, 72], [42, 84], [28, 84]], materialId: 'soil-bed', height: 0, depthIn: 3, width: 0, existing: false };
    const inBedModerate = inst('salvia-leucantha', { position: [30, 75] }); // moderate drainage: amended
    const inBedFast = inst('salvia-bees-bliss', { position: [35, 78] }); // fast drainage: not amended
    const outside = inst('salvia-leucantha', { position: [10, 120] });
    const existing = inst('salvia-leucantha', { position: [32, 80], existing: true, currentHeight: 3, currentWidth: 3 });
    const q = soilQuantities({ plants: placed([inBedModerate, inBedFast, outside, existing]), elements: [bed], soil, hardscapeCfg: engine.hardscape });
    const row = q.rows.find((r) => r.id === 'b1')!;
    expect(row.plants).toBe(2); // existing plant is not planted
    expect(row.areaSf).toBeCloseTo(168, 6);
    expect(row.mulchCuYd).toBeCloseTo((168 * 0.25) / 27, 6);
    const hole = plantingHole('5gal', soil).volumeCuFt / 27;
    expect(row.excavationCuYd).toBeCloseTo(hole * 2, 9);
    expect(row.amendmentCuYd).toBeCloseTo(hole * soil.amendment.fractionOfBackfill, 9); // only the moderate plant
    const loose = q.rows.find((r) => r.id === 'loose')!;
    expect(loose.plants).toBe(1);
    expect(loose.mulchCuYd).toBeGreaterThan(0);
    expect(q.total.plants).toBe(3);
    expect(q.total.excavationCuYd).toBeCloseTo(hole * 3, 9);
  });

  it('computes raised bed fill below the freeboard (WS-14)', () => {
    const rb: HardscapeElement = { id: 'r1', type: 'raisedBed', points: [[0, 0], [4, 0], [4, 8], [0, 8]], materialId: 'raised-bed-wood', height: 1.5, depthIn: 0, width: 0, existing: false };
    const [r] = raisedBedFill([rb], soil, engine.hardscape);
    expect(r.areaSf).toBeCloseTo(32, 6);
    expect(r.fillCuYd).toBeCloseTo((32 * (1.5 - 0.25)) / 27, 9);
  });

  it('flags a tree boxed in by paving (WS-13)', () => {
    const tree = inst('cercis-occidentalis', { position: [30, 100] });
    const open = treeSoilVolumes({ plants: placed([tree]), elements: [], materials: mats, structures: [], lot: site.lot, soil, hardscapeCfg: engine.hardscape })[0];
    expect(open.requiredCuFt).toBeCloseTo(2 * Math.PI * 7.5 ** 2, 6);
    expect(open.shortfallCuFt).toBe(0);
    const slab: HardscapeElement = { id: 's', type: 'patio', points: [[10, 80], [50, 80], [50, 120], [10, 120]], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false };
    const boxed = treeSoilVolumes({ plants: placed([tree]), elements: [slab], materials: mats, structures: [], lot: site.lot, soil, hardscapeCfg: engine.hardscape })[0];
    expect(boxed.availableCuFt).toBeLessThan(open.availableCuFt * 0.2);
    expect(boxed.shortfallCuFt).toBeGreaterThan(0);
  });
});

describe('pollinators (POL-3 to POL-6)', () => {
  const cfg = water.pollinator;

  it('M5 acceptance: the bloom calendar flags a month with no high-value bloom', () => {
    // Lomandra (low value, blooms Mar-May) and agapanthus (moderate, May-Aug) only: no high-value plant at all.
    const none = bloomCalendar(placed([inst('lomandra-longifolia'), inst('agapanthus-africanus')]), cfg);
    expect(none.gaps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Cleveland sage (high, May-Aug) covers May to August only.
    const one = bloomCalendar(placed([inst('salvia-clevelandii')]), cfg);
    expect(one.gaps).toEqual([1, 2, 3, 4, 9, 10, 11, 12]);
    expect(one.scores[4]).toBe(1);
    expect(one.scores[0]).toBe(0);
    // Adding California fuchsia (high, Aug-Nov) closes Sep to Nov, leaving winter gaps.
    const two = bloomCalendar(placed([inst('salvia-clevelandii'), inst('epilobium-canum')]), cfg);
    expect(two.gaps).toEqual([1, 2, 3, 4, 12]);
  });

  it('weights by pollinator value and caps plants counted per species', () => {
    const many = bloomCalendar(placed(Array.from({ length: 8 }, () => inst('salvia-clevelandii'))), cfg);
    expect(many.scores[4]).toBe(cfg.weights.high * cfg.countCap);
    const mixed = bloomCalendar(placed([inst('salvia-clevelandii'), inst('agapanthus-africanus')]), cfg);
    expect(mixed.scores[5]).toBeCloseTo(cfg.weights.high + cfg.weights.moderate, 9); // June: both bloom
  });

  it('summarizes value shares, native share, larval hosts and groups (POL-4)', () => {
    const plants = placed([
      inst('salvia-clevelandii', { existing: true, currentHeight: 4, currentWidth: 4 }),
      inst('agapanthus-africanus', { existing: true, currentHeight: 3, currentWidth: 4 }),
      inst('asclepias-fascicularis', { existing: true, currentHeight: 3, currentWidth: 2 }),
    ]);
    const s = pollinatorSummary(plants);
    expect(s.plants).toBe(3);
    expect(s.byValue.high.plants).toBe(2);
    expect(s.byValue.moderate.plants).toBe(1);
    expect(s.nativePlants).toBe(2);
    expect(s.larvalHostPlants).toBe(1); // milkweed hosts monarch
    expect(s.groups).toContain('hummingbirds');
    expect(s.byValue.high.canopySf + s.byValue.moderate.canopySf + s.byValue.low.canopySf).toBeCloseTo(s.canopySf, 9);
  });

  it('suggests high-value species for a gap that fit the light and water of the scenario (POL-5)', () => {
    const zones = [
      { id: 'front_yard', name: 'Front yard', meanHours: 9, area: 800 },
      { id: 'side_east', name: 'Shady side', meanHours: 2.5, area: 150 },
    ];
    const out = gapSuggestions({ month: 12, library: lib.species, placedSpeciesIds: new Set(['arctostaphylos-howard-mcminn']), placedCategories: ['very low'], zones, growth: engine.growth, limit: 20 });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.species.bloomMonths).toContain(12);
      expect(s.species.pollinator.value).toBe('high');
      expect(s.species.id).not.toBe('arctostaphylos-howard-mcminn');
      expect(['very low', 'low']).toContain(s.species.wucols);
      expect(s.zones.every((z) => z.id === 'front_yard')).toBe(true); // full-sun plants do not fit 2.5 h
    }
    expect(out.some((s) => s.species.id === 'rosmarinus-officinalis')).toBe(true);
  });

  it('warns about invasive plants and bee-attracting groundcover in a play area (POL-6)', () => {
    const inv = { ...sp('lantana-montevidensis'), invasive: true };
    const plants = placed([inst('phyla-nodiflora', { position: [20, 10] }), inst('phyla-nodiflora', { position: [20, 12] })]);
    plants.push({ inst: inst(inv.id, { position: [30, 90] }), species: inv, size: { planted: true, height: 1, width: 4 } });
    const zoneOf = (_x: number, y: number) => (y < 24 ? 'front_yard' : 'back_yard');
    const w = pollinatorWarnings(plants, zoneOf, { front_yard: 'Front yard' }, new Set(['front_yard']));
    expect(w.filter((x) => x.kind === 'play-area').length).toBe(1); // once per species and zone
    expect(w.some((x) => x.kind === 'invasive' && x.message.includes('Trailing lantana'))).toBe(true);
    expect(pollinatorWarnings(plants, zoneOf, {}, new Set()).some((x) => x.kind === 'play-area')).toBe(false);
  });
});

describe('plant schedule (OUT-1)', () => {
  it('groups new plants by species and container, skips existing, and exports CSV', () => {
    const list = [inst('salvia-clevelandii'), inst('salvia-clevelandii'), inst('salvia-clevelandii', { container: '15gal' }), inst('lomandra-longifolia', { existing: true, currentHeight: 3, currentWidth: 3 })];
    const rows = plantSchedule(placed(list), engine.growth, water);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.container === '5 gal')!.quantity).toBe(2);
    expect(rows.find((r) => r.container === '15 gal')!.quantity).toBe(1);
    expect(rows[0].spacingFt).toBe(5); // Cleveland sage mature width
    const csv = scheduleCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Quantity');
    expect(lines[1]).toContain('Salvia clevelandii');
    expect(lines[1]).toContain(`"5'-0"""`);
    expect(csv).not.toContain('Lomandra');
  });
});

describe('assumptions panel (OUT-3)', () => {
  it('lists the sources for water, soil, growth, pollinators and the site', () => {
    const groups = buildAssumptions({ engine, water, soil, site, library: lib });
    expect(groups.map((g) => g.title)).toEqual(['Water demand', 'Soil and planting', 'Growth and light', 'Pollinators and outputs', 'Prices and costs', 'Site']);
    const all = groups.flatMap((g) => g.items);
    expect(all.every((i) => i.source.length > 0)).toBe(true);
    expect(all.find((i) => i.label === 'Formula')!.value).toContain('0.62');
    expect(all.find((i) => i.label.startsWith('Irrigation'))!.value).toContain('0.81');
  });
});

describe('watered area floor for young plants', () => {
  const soilContainers = soilRaw.containers as unknown as SoilConfig['containers'];
  const mk = (speciesId: string, container: PlantInstance['container']): PlantInstance => ({ id: `w-${speciesId}-${container}`, speciesId, position: [30, 90], plantedMonth: 0, container, existing: false });
  const at = (list: PlantInstance[], month: number, containers?: SoilConfig['containers']) => demand(placed(list, month), { timelineMonth: month, containers });

  it('waters a new plant over at least its root-ball area, not its tiny canopy', () => {
    const apple = [mk('malus-mutsu', '5gal')];
    const plain = at(apple, 0);
    const floored = at(apple, 0, soilContainers);
    const canopy = Math.PI * (placed(apple, 0)[0].size.width / 2) ** 2;
    const ball = Math.PI * (((soilContainers['5gal'].ballDiaIn / 12) * water.wetting.ballDiameterFactor) / 2) ** 2;
    expect(plain.rows[0].areaSf).toBeCloseTo(canopy, 6);
    expect(floored.rows[0].areaSf).toBeCloseTo(ball, 6);
    expect(floored.rows[0].areaSf).toBeGreaterThan(canopy * 3);
    expect(floored.lot.annualGal).toBeGreaterThan(plain.lot.annualGal * 3);
  });

  it('uses a bigger floor for a bigger container', () => {
    const small = at([mk('malus-mutsu', '1gal')], 0, soilContainers).rows[0].areaSf;
    const mid = at([mk('malus-mutsu', '5gal')], 0, soilContainers).rows[0].areaSf;
    const big = at([mk('malus-mutsu', '15gal')], 0, soilContainers).rows[0].areaSf;
    expect(small).toBeLessThan(mid);
    expect(mid).toBeLessThan(big);
  });

  it('changes nothing once the canopy is wider than the floor', () => {
    const mature = at([mk('malus-mutsu', '5gal')], 360, soilContainers);
    const plain = at([mk('malus-mutsu', '5gal')], 360);
    expect(mature.lot.annualGal).toBeCloseTo(plain.lot.annualGal, 6);
    expect(mature.rows[0].areaSf).toBeCloseTo(Math.PI * 7.5 ** 2, 6);
  });

  it('puts a young 5 gallon shrub near 4 gallons a week and a 15 gallon tree near 9 in the driest month', () => {
    const jul = (container: PlantInstance['container'], id: string) => {
      const row = at([mk(id, container)], 0, soilContainers).rows[0];
      return row.monthlyGal[6] / (water.daysInMonth[6] / 7);
    };
    expect(jul('5gal', 'vaccinium-misty')).toBeGreaterThan(3);
    expect(jul('5gal', 'vaccinium-misty')).toBeLessThan(9);
    expect(jul('15gal', 'malus-mutsu')).toBeGreaterThan(6);
    expect(jul('15gal', 'malus-mutsu')).toBeLessThan(20);
  });

  it('is flagged as an unverified assumption', () => {
    expect(water.wetting.confidence).toBe('low');
    expect(water.wetting.source).toMatch(/Assumption/);
  });
});
