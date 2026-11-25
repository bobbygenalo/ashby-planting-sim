import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import waterRaw from '../src/data/water.json';
import { polygonArea } from '../src/engine/geometry';
import { placedPlants } from '../src/engine/growth';
import { footprint } from '../src/engine/hardscape';
import { planIrrigation } from '../src/engine/irrigation';
import { buildSchedule, nextRun, runsAt, runsOnDay, weekdayFor } from '../src/engine/irrigationSchedule';
import { emptyScenarioData } from '../src/engine/scenario';
import { doyToMonthDay } from '../src/engine/time';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, PlantInstance, SpeciesLibrary, WaterConfig } from '../src/engine/types';
import { waterDemand } from '../src/engine/water';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const water = waterRaw as unknown as WaterConfig;
const cfg = engine.irrigation;
let n = 0;
const inst = (speciesId: string, x: number, y: number): PlantInstance => ({ id: `s${n++}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false });
const bed = (id: string, x: number, y: number, s = 3): HardscapeElement => ({
  id, type: 'raisedBed', points: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], materialId: 'cedar', height: 1.5, depthIn: 0, width: 0, existing: false,
});

function build(instances: PlantInstance[], extra: HardscapeElement[] = [], bedsOnDrip = true, useRain = false, month = 120) {
  const base = emptyScenarioData(site);
  const elements = [...base.hardscape, ...extra];
  const plants = placedPlants(instances, base.palette, lib.species, month, engine.growth);
  const plan = planIrrigation({
    plants, elements, structures: activeStructures(site, { aduEnabled: true }), lot: site.lot, sources: site.irrigation!.sources,
    hydrozones: [], autoIrrigation: {}, water, hardscapeCfg: engine.hardscape, soilFreeboardIn: 3, bedsOnDrip, cfg,
  });
  const demand = waterDemand({
    plants, lawns: elements.filter((e) => e.type === 'lawn'), hydrozones: [], autoIrrigation: {}, zones: site.zones, timelineMonth: month, water,
    growth: engine.growth, hardscapeCfg: engine.hardscape, useRain,
  });
  const beds = elements.filter((e) => e.type === 'raisedBed' && !e.removed && !e.existing).map((e) => ({ id: e.id, areaSf: polygonArea(footprint(e, engine.hardscape)) }));
  return { plan, demand, schedule: buildSchedule({ plan, rows: demand.rows, beds, water, useRain, cfg }) };
}

const SHRUBS = [inst('coleonema-pulchellum', 30, 76), inst('salvia-leucantha', 38, 76), inst('arctostaphylos-howard-mcminn', 30, 90)];

describe('irrigation schedule', () => {
  it('adds up each valve from the plants on it, using the same demand as the Water tab', () => {
    const { plan, demand, schedule } = build(SHRUBS, [], false);
    for (const v of plan.valves) {
      const expected = v.plantIds.reduce((a, id) => a + demand.rows.find((r) => r.id === id)!.annualGal, 0);
      expect(schedule.valves.find((s) => s.valveId === v.id)!.annualGal).toBeCloseTo(expected, 3);
    }
    expect(schedule.totalAnnualGal).toBeCloseTo(schedule.valveAnnualGal + schedule.handAnnualGal, 6);
  });

  it('counts a raised bed on drip from its area, and by hand when it is not', () => {
    const on = build([], [bed('rb', 34, 100, 6)], true);
    const off = build([], [bed('rb', 34, 100, 6)], false);
    expect(on.schedule.valveAnnualGal).toBeGreaterThan(0);
    expect(off.schedule.valveAnnualGal).toBe(0);
    // the same water is needed either way, it only changes who delivers it
    expect(on.schedule.totalAnnualGal).toBeCloseTo(off.schedule.totalAnnualGal, 6);
    const eff = water.irrigation.drip.efficiency;
    const jul = (water.eto.monthly[6] * cfg.bed.plantFactor * water.formula.conversion * 36) / eff;
    expect(on.schedule.valves[0].monthlyGal[6]).toBeCloseTo(jul, 4);
  });

  it('delivers the water: runs per week times gallons per run is the weekly need', () => {
    const { schedule } = build(SHRUBS);
    for (const v of schedule.valves) for (const m of v.months) {
      if (m.runsPerWeek === 0) continue;
      expect(m.runsPerWeek * m.galPerRun).toBeCloseTo(m.weeklyGal, 6);
      expect(m.weekdays).toHaveLength(m.runsPerWeek);
    }
  });

  it('runs more often in the dry months than the wet ones, and keeps a run within the limit for its device', () => {
    const { plan, schedule } = build(SHRUBS);
    const v = schedule.valves[0];
    const family = plan.valves[0].family;
    expect(v.months[6].weeklyGal).toBeGreaterThan(v.months[0].weeklyGal);
    for (const m of v.months) expect(m.minutesPerRun).toBeLessThanOrEqual(cfg.schedule.maxRunMin[family] + 1e-6);
  });

  it('puts every run inside the early-morning or evening window, one valve after another', () => {
    const { schedule } = build([...SHRUBS, inst('lagerstroemia-indica', 38, 90)], [bed('rb', 34, 100, 6)]);
    for (let month = 1; month <= 12; month++) for (let wd = 0; wd < 7; wd++) {
      const runs = runsOnDay(schedule, month, wd, cfg).filter((r) => !r.overflow);
      for (const r of runs) {
        expect(cfg.schedule.windows.some((w) => r.startMin >= w.startMin - 1e-6 && r.endMin <= w.endMin + 1e-6)).toBe(true);
        // never in the restricted hours
        expect(r.startMin >= 540 && r.startMin < 960).toBe(false);
      }
      // one valve after another on each access
      for (const src of new Set(schedule.valves.map((v) => v.sourceId))) {
        const ids = schedule.valves.filter((v) => v.sourceId === src).map((v) => v.valveId);
        const sorted = runs.filter((r) => ids.includes(r.valveId)).sort((a, b) => a.startMin - b.startMin);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].startMin).toBeGreaterThanOrEqual(sorted[i - 1].endMin - 1e-6);
      }
    }
  });

  it('reports what is running at a minute of the day, and finds the next run', () => {
    const { schedule } = build(SHRUBS);
    const found = nextRun(schedule, 172, 0, engine.referenceYear, cfg, doyToMonthDay);
    expect(found).not.toBeNull();
    const [mo, da] = doyToMonthDay(found!.doy);
    const runs = runsOnDay(schedule, mo, weekdayFor(engine.referenceYear, mo, da), cfg);
    const mid = (found!.run.startMin + found!.run.endMin) / 2;
    expect(runsAt(runs, mid).map((r) => r.valveId)).toContain(found!.run.valveId);
    expect(runsAt(runs, 12 * 60)).toHaveLength(0); // never at noon
  });

  it('needs less applied water when effective rainfall counts', () => {
    const dry = build(SHRUBS, [], true, false);
    const wet = build(SHRUBS, [], true, true);
    expect(wet.schedule.totalAnnualGal).toBeLessThan(dry.schedule.totalAnnualGal);
  });
});
describe('two accesses water at the same time', () => {
  it('runs the first front valve and the first back valve together on their shared days', () => {
    const { plan, schedule } = build([inst('coleonema-pulchellum', 30, 12), inst('coleonema-pulchellum', 30, 110)], [], false);
    expect(new Set(plan.valves.map((v) => v.sourceId)).size).toBe(2);
    let both = 0;
    for (let wd = 0; wd < 7; wd++) {
      const runs = runsOnDay(schedule, 7, wd, cfg);
      const front = runs.find((r) => schedule.valves.find((v) => v.valveId === r.valveId)!.sourceId === 'hose-bib-front');
      const back = runs.find((r) => schedule.valves.find((v) => v.valveId === r.valveId)!.sourceId === 'hose-bib-back');
      if (front && back) {
        both++;
        expect(front.startMin).toBe(cfg.schedule.windows[0].startMin);
        expect(back.startMin).toBe(cfg.schedule.windows[0].startMin);
      }
    }
    expect(both).toBeGreaterThan(0);
  });
});
