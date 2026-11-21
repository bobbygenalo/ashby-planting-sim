import { pointInPolygon, polygonArea } from './geometry';
import type { PlacedPlant } from './growth';
import { footprint } from './hardscape';
import type { EngineConfig, HardscapeElement, Hydrozone, Irrigation, PlantInstance, PlantType, Species, WaterConfig } from './types';

export const WATER_ORDER = ['very low', 'low', 'moderate', 'high'] as const;
export type WaterCategory = (typeof WATER_ORDER)[number];

/** Plant factor for a WUCOLS category (default within the MWELO range). */
export function plantFactorFor(category: string, growth: EngineConfig['growth']): number {
  return growth.wucolsPlantFactor[category] ?? 0.5;
}

/** Months since planting; null for existing plants. */
export function monthsSincePlanting(inst: PlantInstance, timelineMonth: number): number | null {
  return inst.existing ? null : timelineMonth - inst.plantedMonth;
}

/** Establishment multiplier (WS-3): extra water for a set period after planting. Existing plants are established. */
export function establishmentMultiplier(inst: PlantInstance, type: PlantType, timelineMonth: number, cfg: WaterConfig): number {
  const age = monthsSincePlanting(inst, timelineMonth);
  if (age === null) return 1;
  const e = cfg.establishment[type];
  return age < e.months ? e.multiplier : 1;
}

/**
 * Monthly applied water in gallons for one plant or area (WS-1):
 * ETo x 0.62 x (PF x A) / IE, optionally net of effective rainfall (WS-8).
 * With rainfall, the plant's need (ETo x PF) is reduced by effective rain, floored at zero, before dividing by IE.
 */
export function monthlyGallons(args: {
  eto: number[];
  rain: number[] | null;
  plantFactor: number;
  areaSf: number;
  efficiency: number;
  multiplier?: number;
  conversion: number;
}): number[] {
  const { eto, rain, plantFactor, areaSf, efficiency, conversion } = args;
  const mult = args.multiplier ?? 1;
  return eto.map((e, m) => {
    if (efficiency <= 0) return 0;
    const need = e * plantFactor * mult;
    const net = rain ? Math.max(0, need - rain[m]) : need;
    return (net * conversion * areaSf) / efficiency;
  });
}

export interface ResolvedHydrozone {
  id: string;
  name: string;
  irrigation: Irrigation;
  auto: boolean;
}

/** The hydrozone a plant belongs to: its explicit one, or an automatic zone per water-use category. */
export function hydrozoneOf(
  inst: PlantInstance,
  sp: Species,
  hydrozones: Hydrozone[],
  autoIrrigation: Record<string, Irrigation>,
  cfg: WaterConfig,
): ResolvedHydrozone {
  const explicit = inst.hydrozoneId ? hydrozones.find((h) => h.id === inst.hydrozoneId) : undefined;
  if (explicit) return { id: explicit.id, name: explicit.name, irrigation: explicit.irrigation, auto: false };
  const id = `auto:${sp.wucols}`;
  return {
    id,
    name: `${cap(sp.wucols)} water (automatic)`,
    irrigation: autoIrrigation[id] ?? cfg.defaultIrrigation[sp.type],
    auto: true,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function canopyAreaSf(widthFt: number): number {
  return Math.PI * (widthFt / 2) ** 2;
}

export interface DemandInput {
  plants: PlacedPlant[];
  lawns: HardscapeElement[];
  hydrozones: Hydrozone[];
  autoIrrigation: Record<string, Irrigation>;
  zones: { id: string; name: string; polygon: [number, number][] }[];
  timelineMonth: number;
  water: WaterConfig;
  growth: EngineConfig['growth'];
  hardscapeCfg: EngineConfig['hardscape'];
  useRain: boolean;
}

export interface DemandRow {
  id: string;
  label: string;
  kind: 'plant' | 'lawn';
  hydrozoneId: string;
  yardZoneId: string;
  category: string;
  areaSf: number;
  plantFactor: number;
  multiplier: number;
  efficiency: number;
  monthlyGal: number[];
  annualGal: number;
}

export interface HydrozoneSummary {
  id: string;
  name: string;
  irrigation: Irrigation;
  efficiency: number;
  auto: boolean;
  members: number;
  areaSf: number;
  categories: string[];
  monthlyGal: number[];
  annualGal: number;
  /** Gallons per week for each month (monthly total spread over that month's weeks). */
  weeklyGal: number[];
  /** Applied depth in inches per week over the zone's canopy area. */
  weeklyInches: number[];
  warning: string | null;
}

export interface Rollup {
  id: string;
  name: string;
  areaSf: number;
  monthlyGal: number[];
  annualGal: number;
}

const sum12 = (a: number[]) => a.reduce((x, y) => x + y, 0);
const add12 = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
const zeros = () => new Array(12).fill(0) as number[];

export function waterDemand(input: DemandInput): {
  rows: DemandRow[];
  hydrozones: HydrozoneSummary[];
  yardZones: Rollup[];
  lot: Rollup;
} {
  const { water, growth } = input;
  const rain = input.useRain ? water.rainfall.monthly.map((r) => r * water.rainfall.effectiveFraction) : null;
  const rows: DemandRow[] = [];

  const yardOf = (x: number, y: number) => input.zones.find((z) => pointInPolygon(x, y, z.polygon))?.id ?? 'other';

  for (const p of input.plants) {
    const hz = hydrozoneOf(p.inst, p.species, input.hydrozones, input.autoIrrigation, water);
    const eff = water.irrigation[hz.irrigation].efficiency;
    const pf = plantFactorFor(p.species.wucols, growth);
    const mult = establishmentMultiplier(p.inst, p.species.type, input.timelineMonth, water);
    const area = canopyAreaSf(p.size.width);
    const monthly = monthlyGallons({ eto: water.eto.monthly, rain, plantFactor: pf, areaSf: area, efficiency: eff, multiplier: mult, conversion: water.formula.conversion });
    rows.push({
      id: p.inst.id, label: p.species.common, kind: 'plant', hydrozoneId: hz.id,
      yardZoneId: yardOf(p.inst.position[0], p.inst.position[1]), category: p.species.wucols,
      areaSf: area, plantFactor: pf, multiplier: mult, efficiency: eff, monthlyGal: monthly, annualGal: sum12(monthly),
    });
  }

  for (const el of input.lawns) {
    if (el.removed) continue;
    const poly = footprint(el, input.hardscapeCfg);
    const area = polygonArea(poly);
    const eff = water.irrigation[water.lawn.irrigation].efficiency;
    const monthly = monthlyGallons({ eto: water.eto.monthly, rain, plantFactor: water.lawn.plantFactor, areaSf: area, efficiency: eff, conversion: water.formula.conversion });
    const cx = poly.reduce((a, q) => a + q[0], 0) / Math.max(1, poly.length);
    const cy = poly.reduce((a, q) => a + q[1], 0) / Math.max(1, poly.length);
    rows.push({
      id: el.id, label: el.name ?? 'Lawn', kind: 'lawn', hydrozoneId: 'auto:lawn', yardZoneId: yardOf(cx, cy), category: 'high',
      areaSf: area, plantFactor: water.lawn.plantFactor, multiplier: 1, efficiency: eff, monthlyGal: monthly, annualGal: sum12(monthly),
    });
  }

  // Hydrozone roll-up
  const hzMap = new Map<string, HydrozoneSummary>();
  const plantById = new Map(input.plants.map((p) => [p.inst.id, p]));
  for (const r of rows) {
    let h = hzMap.get(r.hydrozoneId);
    if (!h) {
      if (r.kind === 'lawn') {
        h = { id: 'auto:lawn', name: 'Lawn (automatic)', irrigation: water.lawn.irrigation, efficiency: water.irrigation[water.lawn.irrigation].efficiency, auto: true, members: 0, areaSf: 0, categories: [], monthlyGal: zeros(), annualGal: 0, weeklyGal: zeros(), weeklyInches: zeros(), warning: null };
      } else {
        const p = plantById.get(r.id)!;
        const hz = hydrozoneOf(p.inst, p.species, input.hydrozones, input.autoIrrigation, water);
        h = { id: hz.id, name: hz.name, irrigation: hz.irrigation, efficiency: water.irrigation[hz.irrigation].efficiency, auto: hz.auto, members: 0, areaSf: 0, categories: [], monthlyGal: zeros(), annualGal: 0, weeklyGal: zeros(), weeklyInches: zeros(), warning: null };
      }
      hzMap.set(r.hydrozoneId, h);
    }
    h.members++;
    h.areaSf += r.areaSf;
    if (!h.categories.includes(r.category)) h.categories.push(r.category);
    h.monthlyGal = add12(h.monthlyGal, r.monthlyGal);
    h.annualGal += r.annualGal;
  }
  // Explicit hydrozones with no members still appear, so the owner can see and assign to them.
  for (const hz of input.hydrozones) {
    if (!hzMap.has(hz.id)) {
      hzMap.set(hz.id, { id: hz.id, name: hz.name, irrigation: hz.irrigation, efficiency: water.irrigation[hz.irrigation].efficiency, auto: false, members: 0, areaSf: 0, categories: [], monthlyGal: zeros(), annualGal: 0, weeklyGal: zeros(), weeklyInches: zeros(), warning: null });
    }
  }
  for (const h of hzMap.values()) {
    h.categories.sort((a, b) => WATER_ORDER.indexOf(a as WaterCategory) - WATER_ORDER.indexOf(b as WaterCategory));
    h.weeklyGal = h.monthlyGal.map((g, m) => (g * 7) / water.daysInMonth[m]);
    h.weeklyInches = h.weeklyGal.map((g) => (h.areaSf > 0 ? g / (water.formula.conversion * h.areaSf) : 0));
    h.warning = hydrozoneMixWarning(h.categories);
  }

  const yardMap = new Map<string, Rollup>();
  const nameOf = (id: string) => (id === 'other' ? 'Elsewhere on the lot' : input.zones.find((z) => z.id === id)?.name ?? id);
  for (const r of rows) {
    const y = yardMap.get(r.yardZoneId) ?? { id: r.yardZoneId, name: nameOf(r.yardZoneId), areaSf: 0, monthlyGal: zeros(), annualGal: 0 };
    y.areaSf += r.areaSf;
    y.monthlyGal = add12(y.monthlyGal, r.monthlyGal);
    y.annualGal += r.annualGal;
    yardMap.set(r.yardZoneId, y);
  }
  const lot: Rollup = { id: 'lot', name: 'Whole lot', areaSf: 0, monthlyGal: zeros(), annualGal: 0 };
  for (const r of rows) {
    lot.areaSf += r.areaSf;
    lot.monthlyGal = add12(lot.monthlyGal, r.monthlyGal);
    lot.annualGal += r.annualGal;
  }
  return { rows, hydrozones: [...hzMap.values()], yardZones: [...yardMap.values()], lot };
}

/** Warn when a hydrozone mixes water-use categories that are not adjacent (WS-4). */
export function hydrozoneMixWarning(categories: string[]): string | null {
  if (categories.length < 2) return null;
  const idx = categories.map((c) => WATER_ORDER.indexOf(c as WaterCategory)).filter((i) => i >= 0);
  if (Math.max(...idx) - Math.min(...idx) < 2) return null;
  return `Mixes ${categories.join(' and ')} water plants. Plants this far apart in need cannot be watered well on one schedule.`;
}

/**
 * Informational MWELO-style budget (WS-7): MAWA = ETo x 0.62 x ETAF x landscape area.
 * Landscape area is bed, lawn and raised-bed area, plus canopy area of plants outside those.
 * This is a benchmark, not a compliance finding.
 */
export function waterBudget(args: {
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  water: WaterConfig;
  hardscapeCfg: EngineConfig['hardscape'];
  annualDemandGal: number;
}): { landscapeAreaSf: number; annualAllowanceGal: number; monthlyAllowanceGal: number[]; ratio: number | null } {
  const planted = args.elements.filter((e) => !e.removed && (e.type === 'bed' || e.type === 'lawn' || e.type === 'raisedBed'));
  const polys = planted.map((e) => footprint(e, args.hardscapeCfg));
  let area = polys.reduce((a, p) => a + polygonArea(p), 0);
  for (const p of args.plants) {
    const [x, y] = p.inst.position;
    if (!polys.some((poly) => pointInPolygon(x, y, poly))) area += canopyAreaSf(p.size.width);
  }
  const k = args.water.formula.conversion * args.water.budget.etaf * area;
  const monthly = args.water.eto.monthly.map((e) => e * k);
  const annual = sum12(monthly);
  return { landscapeAreaSf: area, annualAllowanceGal: annual, monthlyAllowanceGal: monthly, ratio: annual > 0 ? args.annualDemandGal / annual : null };
}
