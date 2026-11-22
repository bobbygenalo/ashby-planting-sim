import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import waterRaw from '../src/data/water.json';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { takeoff, takeoffCsv } from '../src/engine/hardscape';
import { elementPrice, emptyPrices, hardscapeCosts, plantCosts, plantPrice, projectCost } from '../src/engine/pricing';
import { plantSchedule, scheduleCsv } from '../src/engine/schedule';
import { emptyScenarioData, validateScenarioData } from '../src/engine/scenario';
import { loadSite } from '../src/engine/site';
import siteRaw from '../src/data/site.json';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary, WaterConfig } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const water = waterRaw as unknown as WaterConfig;
const site = loadSite(siteRaw);
const mat = (id: string) => mats.find((m) => m.id === id)!;
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const inst = (id: string, speciesId: string, container: PlantInstance['container'] = '5gal', over: Partial<PlantInstance> = {}): PlantInstance => ({ id, speciesId, position: [30, 100], plantedMonth: 0, container, existing: false, ...over });
const placed = (i: PlantInstance): PlacedPlant => ({ inst: i, species: sp(i.speciesId), size: instanceSize(i, sp(i.speciesId), 0, engine.growth) });
const el = (id: string, type: HardscapeElement['type'], pts: [number, number][], materialId: string, over: Partial<HardscapeElement> = {}): HardscapeElement => ({ id, type, points: pts, materialId, height: 0, depthIn: 4, width: type === 'wall' || type === 'fence' ? 0.5 : type === 'path' ? 3 : 0, existing: false, ...over });
const rect = (x: number, y: number, w: number, d: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const cfg = engine.pricing;
const hs = engine.hardscape;

describe('plant prices', () => {
  it('use the container default, then the owner\'s species price, then the plant\'s own', () => {
    const s = sp('salvia-leucantha');
    const i = inst('a', s.id, '15gal');
    expect(plantPrice(i, s, emptyPrices(), cfg)).toEqual({ price: cfg.plantByContainer['15gal'], source: 'default' });
    expect(plantPrice(i, s, { plant: { [s.id]: 22 }, material: {} }, cfg)).toEqual({ price: 22, source: 'kind' });
    expect(plantPrice({ ...i, price: 9 }, s, { plant: { [s.id]: 22 }, material: {} }, cfg)).toEqual({ price: 9, source: 'item' });
    // a price of zero is a price (a gift, a cutting), not "unset"
    expect(plantPrice({ ...i, price: 0 }, s, emptyPrices(), cfg).price).toBe(0);
  });

  it('have a default for every container, rising with size', () => {
    const order = ['1gal', '5gal', '15gal', '24box'].map((c) => cfg.plantByContainer[c]);
    for (const c of Object.keys(engine.growth.containers)) expect(cfg.plantByContainer[c], c).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('add up by species and container, count new plants only, and average a mix of prices', () => {
    const s = sp('salvia-leucantha');
    const plants = [placed(inst('a', s.id, '5gal')), placed(inst('b', s.id, '5gal', { price: 100 })), placed(inst('c', s.id, '15gal')), placed(inst('old', s.id, '5gal', { existing: true }))];
    const r = plantCosts(plants, emptyPrices(), cfg);
    expect(r.rows).toHaveLength(2);
    const five = r.rows.find((x) => x.container === '5gal')!;
    expect(five.quantity).toBe(2);
    expect(five.total).toBe(cfg.plantByContainer['5gal'] + 100);
    expect(five.unitPrice).toBe(five.total / 2);
    expect(r.total).toBe(five.total + cfg.plantByContainer['15gal']);
  });

  it('flow into the plant schedule, its CSV and the total row', () => {
    const s = sp('salvia-leucantha');
    const plants = [placed(inst('a', s.id)), placed(inst('b', s.id)), placed(inst('c', 'lomandra-longifolia', '1gal'))];
    const rows = plantSchedule(plants, engine.growth, water, { prices: { plant: { 'lomandra-longifolia': 7.5 }, material: {} }, cfg });
    const salvia = rows.find((r) => r.speciesId === s.id)!;
    expect(salvia.quantity).toBe(2);
    expect(salvia.unitPrice).toBe(cfg.plantByContainer['5gal']);
    expect(salvia.total).toBe(2 * cfg.plantByContainer['5gal']);
    expect(rows.find((r) => r.speciesId === 'lomandra-longifolia')!.total).toBe(7.5);
    const csv = scheduleCsv(rows).split('\n');
    expect(csv[0]).toContain('Price each');
    expect(csv[0]).toContain('Total (USD)');
    expect(csv[csv.length - 1]).toContain((2 * cfg.plantByContainer['5gal'] + 7.5).toFixed(2));
    // without prices the schedule still works and shows zero
    expect(plantSchedule(plants, engine.growth, water).every((r) => r.total === 0)).toBe(true);
  });
});

describe('hardscape prices', () => {
  it('price an area by square foot, a wall by length, and a table by the piece', () => {
    const patio = el('p', 'patio', rect(10, 10, 10, 12), 'concrete');
    const wall = el('w', 'wall', [[0, 0], [20, 0]], 'cmu-wall');
    const table = el('t', 'table', rect(5, 5, 11, 6.5), 'outdoor-table');
    const none = emptyPrices();
    const pa = elementPrice(patio, mat('concrete'), hs, none);
    expect(pa.basis).toBe('sf');
    expect(pa.quantity).toBeCloseTo(120, 6);
    expect(pa.total).toBeCloseTo(120 * mat('concrete').price!, 6);
    const pw = elementPrice(wall, mat('cmu-wall'), hs, none);
    expect(pw.basis).toBe('lf');
    expect(pw.quantity).toBeCloseTo(20, 6);
    expect(pw.total).toBeCloseTo(20 * mat('cmu-wall').price!, 6);
    const pt = elementPrice(table, mat('outdoor-table'), hs, none);
    expect(pt.basis).toBe('each');
    expect(pt.quantity).toBe(1);
    expect(pt.total).toBe(mat('outdoor-table').price);
  });

  it('use the owner\'s price for a material, and a price on one element beats both', () => {
    const patio = el('p', 'patio', rect(0, 0, 10, 10), 'concrete');
    expect(elementPrice(patio, mat('concrete'), hs, { plant: {}, material: { concrete: 20 } })).toMatchObject({ unit: 20, total: 2000, source: 'kind' });
    expect(elementPrice({ ...patio, price: 750 }, mat('concrete'), hs, { plant: {}, material: { concrete: 20 } })).toMatchObject({ total: 750, source: 'item' });
    expect(elementPrice(patio, mat('concrete'), hs, emptyPrices()).source).toBe('default');
  });

  it('total new work by material, leaving out existing and removed elements', () => {
    const els = [
      el('a', 'patio', rect(0, 0, 10, 10), 'concrete'), el('b', 'patio', rect(20, 0, 10, 10), 'concrete'),
      el('c', 'lawn', rect(0, 20, 10, 10), 'lawn'),
      el('old', 'patio', rect(0, 40, 10, 10), 'concrete', { existing: true }), el('gone', 'patio', rect(0, 60, 10, 10), 'concrete', { removed: true }),
    ];
    const r = hardscapeCosts(els, mats, hs, emptyPrices());
    const concrete = r.rows.find((x) => x.materialId === 'concrete')!;
    expect(concrete.count).toBe(2);
    expect(concrete.quantity).toBeCloseTo(200, 6);
    expect(concrete.total).toBeCloseTo(200 * mat('concrete').price!, 6);
    expect(r.total).toBeCloseTo(200 * mat('concrete').price! + 100 * mat('lawn').price!, 6);
    expect(r.rows.map((x) => x.name)).toEqual([...r.rows.map((x) => x.name)].sort((a, b) => a.localeCompare(b)));
    // the takeoff CSV carries the prices and a total
    const tk = takeoff(els, mats, hs);
    const csv = takeoffCsv(tk.rows, new Map(r.rows.map((x) => [x.materialId, { unitPrice: x.unitPrice, basis: 'sq ft', total: x.total }]))).split('\n');
    expect(csv[0]).toContain('Total (USD)');
    expect(csv[csv.length - 1]).toContain(r.total.toFixed(2));
    expect(takeoffCsv(tk.rows)).not.toContain('USD'); // unchanged without prices
  });

  it('give every material a price and a basis', () => {
    for (const m of mats) {
      expect(m.price, m.id).toBeGreaterThan(0);
      expect(['sf', 'lf', 'each']).toContain(m.priceBasis);
    }
    expect(mat('cmu-wall').priceBasis).toBe('lf');
    expect(mat('outdoor-table').priceBasis).toBe('each');
    expect(mat('grill-station').priceBasis).toBe('each');
  });
});

describe('project cost', () => {
  it('adds the plants and the hardscape, and moves with a price the owner sets', () => {
    const plants = [placed(inst('a', 'salvia-leucantha'))];
    const els = [el('p', 'patio', rect(0, 0, 10, 10), 'concrete')];
    const base = projectCost(plants, els, mats, engine, emptyPrices());
    expect(base.total).toBeCloseTo(cfg.plantByContainer['5gal'] + 100 * mat('concrete').price!, 6);
    expect(base.total).toBe(base.plants + base.hardscape);
    const dearer = projectCost(plants, els, mats, engine, { plant: {}, material: { concrete: 30 } });
    expect(dearer.hardscape).toBeCloseTo(3000, 6);
  });
});

describe('prices in the store', () => {
  it('set and clear a plant\'s or a material\'s price, with undo, per scenario', () => {
    const s = makeAppStore('edit');
    s.getState().setPlantPrice('salvia-leucantha', 22);
    s.getState().setMaterialPrice('concrete', 15);
    expect(s.getState().prices).toEqual({ plant: { 'salvia-leucantha': 22 }, material: { concrete: 15 } });
    s.getState().setPlantPrice('salvia-leucantha', null);
    expect(s.getState().prices.plant).toEqual({});
    s.getState().undo();
    expect(s.getState().prices.plant['salvia-leucantha']).toBe(22);
    s.getState().setPlantPrice('x', -5); // a negative price clears
    expect(s.getState().prices.plant.x).toBeUndefined();
    const first = s.getState().activeScenarioId;
    s.getState().createScenario();
    expect(s.getState().prices).toEqual({ plant: {}, material: {} });
    s.getState().switchScenario(first);
    expect(s.getState().prices.material.concrete).toBe(15);
    const v = makeAppStore('view');
    v.getState().setMaterialPrice('concrete', 99);
    expect(v.getState().prices.material).toEqual({});
  });

  it('are saved with the scenario, and bad values are dropped on the way in', () => {
    const ctx = { speciesIds: new Set(lib.species.map((x) => x.id)), containers: new Set(Object.keys(engine.growth.containers)), hardscapeTypes: new Set(Object.keys(engine.hardscape.types)), materialIds: new Set(mats.map((m) => m.id)), zoneIds: new Set(site.zones.map((z) => z.id)) };
    const d = { ...emptyScenarioData(site), prices: { plant: { a: 12 }, material: { concrete: 9 } } };
    expect(validateScenarioData(JSON.parse(JSON.stringify(d)), ctx).data!.prices).toEqual({ plant: { a: 12 }, material: { concrete: 9 } });
    const messy = validateScenarioData({ ...d, prices: { plant: { a: -3, b: 'x', c: NaN, d: 5 }, material: 7 } }, ctx).data!.prices;
    expect(messy).toEqual({ plant: { d: 5 }, material: {} });
    const { prices: _p, ...older } = d;
    void _p;
    expect(validateScenarioData(older, ctx).data!.prices).toEqual({ plant: {}, material: {} });
  });

  it('put a price on a single plant or element through the usual update actions', () => {
    const s = makeAppStore('edit');
    s.getState().addInstance('salvia-leucantha', [20, 90]);
    const id = s.getState().instances[0].id;
    s.getState().updateInstance(id, { price: 55 });
    expect(plantPrice(s.getState().instances[0], sp('salvia-leucantha'), s.getState().prices, cfg)).toEqual({ price: 55, source: 'item' });
    s.getState().startDrawing('patio');
    for (const p of rect(20, 90, 10, 10)) s.getState().addDrawPoint(p);
    const eid = s.getState().finishDrawing()!;
    s.getState().updateElement(eid, { price: 1234 });
    const e = s.getState().hardscape.find((x) => x.id === eid)!;
    expect(elementPrice(e, mat(e.materialId), hs, s.getState().prices).total).toBe(1234);
  });
});
