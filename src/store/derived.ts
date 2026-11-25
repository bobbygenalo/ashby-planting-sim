import { useDeferredValue, useEffect, useMemo } from 'react';
import { detectConflicts } from '../engine/conflicts';
import { activeStructures } from '../engine/site';
import { pointInPolygon } from '../engine/geometry';
import { placedPlants, type PlacedPlant } from '../engine/growth';
import { planIrrigation, type IrrigationPlan } from '../engine/irrigation';
import { buildSchedule, nextRun, waterByYear, type IrrigationSchedule, type ValveRun } from '../engine/irrigationSchedule';
import { doyToMonthDay } from '../engine/time';
import { footprint } from '../engine/hardscape';
import { polygonArea } from '../engine/geometry';
import soilRaw from '../data/soil.json';
import { costReadout, waterCost, type CostReadout } from '../engine/pricing';
import { waterDemand } from '../engine/water';
import { appStore, useApp } from './store';

/** Plants in the palette that exist at the timeline month, with their simulated size. */
export function usePlaced(): PlacedPlant[] {
  const instances = useApp((s) => s.instances);
  const palette = useApp((s) => s.palette);
  const library = useApp((s) => s.library);
  const month = useApp((s) => s.timelineMonth);
  const engine = useApp((s) => s.engine);
  return useMemo(() => placedPlants(instances, palette, library.species, month, engine.growth), [instances, palette, library, month, engine]);
}

/** Water demand for the current scenario at the timeline year (WS-1). */
export function useWaterDemand() {
  const plants = usePlaced();
  const hardscape = useApp((s) => s.hardscape);
  const hydrozones = useApp((s) => s.hydrozones);
  const autoIrrigation = useApp((s) => s.autoIrrigation);
  const useRain = useApp((s) => s.useRain);
  const site = useApp((s) => s.site);
  const water = useApp((s) => s.water);
  const engine = useApp((s) => s.engine);
  const month = useApp((s) => s.timelineMonth);
  return useMemo(
    () =>
      waterDemand({
        plants,
        lawns: hardscape.filter((e) => e.type === 'lawn'),
        hydrozones,
        autoIrrigation,
        zones: site.zones,
        timelineMonth: month,
        water,
        growth: engine.growth,
        hardscapeCfg: engine.hardscape,
        useRain,
        containers: soilRaw.containers,
      }),
    [plants, hardscape, hydrozones, autoIrrigation, site, water, engine, month, useRain],
  );
}

/** Id of the yard zone containing a point, or null. */
export function zoneIdAt(zones: { id: string; polygon: [number, number][] }[], x: number, y: number): string | null {
  return zones.find((z) => pointInPolygon(x, y, z.polygon))?.id ?? null;
}

/**
 * Keep the conflict list current: scan the whole timeline whenever the plan changes (GR-6).
 * Inputs are deferred so dragging a plant stays smooth.
 */
export function useConflictSync() {
  const instances = useDeferredValue(useApp((s) => s.instances));
  const palette = useDeferredValue(useApp((s) => s.palette));
  const hardscape = useDeferredValue(useApp((s) => s.hardscape));
  const library = useApp((s) => s.library);
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const conflicts = useMemo(
    () =>
      detectConflicts({
        instances,
        palette,
        species: library.species,
        structures: activeStructures(site, { aduEnabled }),
        elements: hardscape,
        easements: site.easements,
        contextTrees: site.contextObjects
          .filter((o) => o.kind === 'tree' && o.position)
          .map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], height: o.height, width: o.canopyWidth ?? 10 })),
        lot: site.lot,
        cfg: engine,
        maxMonths: engine.timeline.maxYears * 12,
      }),
    [instances, palette, hardscape, library, site, engine, aduEnabled],
  );
  useEffect(() => {
    appStore.getState().setConflicts(conflicts);
  }, [conflicts]);
}

let irrigationCache: { deps: unknown[]; plan: IrrigationPlan | null } | null = null;

/**
 * The suggested irrigation layout (null when the site has no water source). Inputs are deferred so dragging a plant
 * stays smooth, and the last answer is shared by every caller (the yard layer and the Water & soil panel).
 */
export function useIrrigationPlan(): IrrigationPlan | null {
  const instances = useDeferredValue(useApp((s) => s.instances));
  const palette = useApp((s) => s.palette);
  const hardscape = useDeferredValue(useApp((s) => s.hardscape));
  const hydrozones = useApp((s) => s.hydrozones);
  const autoIrrigation = useApp((s) => s.autoIrrigation);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const site = useApp((s) => s.site);
  const water = useApp((s) => s.water);
  const library = useApp((s) => s.library);
  const engine = useApp((s) => s.engine);
  const month = useApp((s) => s.timelineMonth);
  const bedsOnDrip = useApp((s) => s.layers.irrigationBeds);
  const deps = [instances, palette, hardscape, hydrozones, autoIrrigation, aduEnabled, site, water, library, engine, month, bedsOnDrip];
  const hit = irrigationCache && irrigationCache.deps.length === deps.length && irrigationCache.deps.every((d, i) => d === deps[i]);
  if (!hit) {
    const sources = site.irrigation?.sources ?? [];
    const plan = sources.length > 0
      ? planIrrigation({
          plants: placedPlants(instances, palette, library.species, month, engine.growth),
          elements: hardscape,
          structures: activeStructures(site, { aduEnabled }),
          lot: site.lot,
          sources,
          hydrozones,
          autoIrrigation,
          water,
          hardscapeCfg: engine.hardscape,
          bedsOnDrip,
          soilFreeboardIn: soilRaw.raisedBed.freeboardIn,
          cfg: engine.irrigation,
        })
      : null;
    irrigationCache = { deps, plan };
  }
  return irrigationCache!.plan;
}

/** The water the scenario needs through its irrigation layout and a typical weekly schedule for it (null with no layout). */
export function useIrrigationSchedule(): IrrigationSchedule | null {
  const plan = useIrrigationPlan();
  const demand = useWaterDemand();
  const hardscape = useApp((s) => s.hardscape);
  const water = useApp((s) => s.water);
  const useRain = useApp((s) => s.useRain);
  const engine = useApp((s) => s.engine);
  return useMemo(() => {
    if (!plan) return null;
    const beds = hardscape.filter((e) => e.type === 'raisedBed' && !e.removed && !e.existing).map((e) => ({ id: e.id, areaSf: polygonArea(footprint(e, engine.hardscape)) }));
    return buildSchedule({ plan, rows: demand.rows, beds, water, useRain, cfg: engine.irrigation });
  }, [plan, demand, hardscape, water, useRain, engine]);
}

/** Live cost of the current scenario: hardscape and planting up front, the irrigation system's parts, and a year of water. */
export function useCostReadout(): CostReadout {
  const plants = usePlaced();
  const hardscape = useApp((s) => s.hardscape);
  const materials = useApp((s) => s.materials);
  const engine = useApp((s) => s.engine);
  const prices = useApp((s) => s.prices);
  const plan = useIrrigationPlan();
  const schedule = useIrrigationSchedule();
  const demand = useWaterDemand();
  return useMemo(
    () => costReadout({
      plants, elements: hardscape, materials, engine, prices,
      irrigationSystemCost: plan?.cost ?? 0,
      waterGallonsPerYear: schedule?.totalAnnualGal ?? demand.lot.annualGal,
    }),
    [plants, hardscape, materials, engine, prices, plan, schedule, demand],
  );
}

/**
 * The next time a valve runs from the sun dock's date and time, and a function that moves the sun dock into it (a minute in,
 * so water is already moving) and switches the irrigation layout on. Valves only run early morning and evening, so at noon
 * nothing is flowing until the sun time is moved.
 */
export function useShowRun(): { next: { doy: number; run: ValveRun } | null; jump: () => void } {
  const schedule = useIrrigationSchedule();
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const setDoy = useApp((s) => s.setDoy);
  const setMinutes = useApp((s) => s.setMinutes);
  const setLayer = useApp((s) => s.setLayer);
  const next = useMemo(() => (schedule ? nextRun(schedule, doy, minutes, engine.referenceYear, engine.irrigation, doyToMonthDay) : null), [schedule, engine, doy, minutes]);
  const jump = () => {
    if (!next) return;
    setDoy(next.doy);
    setMinutes(Math.floor(next.run.startMin + Math.min(1, (next.run.endMin - next.run.startMin) / 2)));
    setLayer('irrigation', true);
  };
  return { next, jump };
}

export interface WaterCostOverTime {
  /** A few ages of the planting (0 is the day of planting), each with its applied gallons and cost for that year. */
  milestones: { year: number; gallons: number; cost: number }[];
  /** All thirty years added up, at today's rate. */
  thirtyYearGallons: number;
  thirtyYearCost: number;
}

/** How the water cost grows as the plants do: the scenario's yearly water at several ages, and the first thirty years added up. */
export function useWaterCostOverTime(): WaterCostOverTime {
  const instances = useApp((s) => s.instances);
  const palette = useApp((s) => s.palette);
  const hardscape = useApp((s) => s.hardscape);
  const hydrozones = useApp((s) => s.hydrozones);
  const autoIrrigation = useApp((s) => s.autoIrrigation);
  const site = useApp((s) => s.site);
  const water = useApp((s) => s.water);
  const library = useApp((s) => s.library);
  const engine = useApp((s) => s.engine);
  const useRain = useApp((s) => s.useRain);
  return useMemo(() => {
    const last = engine.timeline.maxYears;
    const years = Array.from({ length: last + 1 }, (_, i) => i);
    const beds = hardscape.filter((e) => e.type === 'raisedBed' && !e.removed && !e.existing).map((e) => {
      const points = footprint(e, engine.hardscape);
      return { points, areaSf: polygonArea(points) };
    });
    const per = waterByYear({
      years, plantsAt: (y) => placedPlants(instances, palette, library.species, y * 12, engine.growth),
      lawns: hardscape.filter((e) => e.type === 'lawn'), hydrozones, autoIrrigation, zones: site.zones, water, growth: engine.growth,
      hardscapeCfg: engine.hardscape, useRain, beds, cfg: engine.irrigation, containers: soilRaw.containers,
    });
    const cost = (g: number) => waterCost(g, engine.pricing);
    const marks = [0, 2, 5, 10, last].filter((y, i, a) => a.indexOf(y) === i && y <= last);
    // thirty years of watering: years 0 to last - 1, each at the size the plants have that year
    const span = per.slice(0, last);
    const gal = span.reduce((a, r) => a + r.gallons, 0);
    return {
      milestones: marks.map((y) => ({ year: y, gallons: per[y].gallons, cost: cost(per[y].gallons) })),
      thirtyYearGallons: gal, thirtyYearCost: cost(gal),
    };
  }, [instances, palette, hardscape, hydrozones, autoIrrigation, site, water, library, engine, useRain]);
}
