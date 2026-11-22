import { elementMetrics } from './hardscape';
import type { PlacedPlant } from './growth';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, PricingCfg, Prices, Species } from './types';

export const emptyPrices = (): Prices => ({ plant: {}, material: {} });

/** Where a price came from: the owner's price for this plant or element, the owner's for its kind, or the stand-in default. */
export type PriceSource = 'item' | 'kind' | 'default';

export interface PlantPrice {
  price: number;
  source: PriceSource;
}

/** One plant's price: its own, else the owner's price for its species, else the default for its container. */
export function plantPrice(inst: PlantInstance, sp: Species, prices: Prices, cfg: PricingCfg): PlantPrice {
  if (inst.price !== undefined) return { price: inst.price, source: 'item' };
  const own = prices.plant[sp.id];
  if (own !== undefined) return { price: own, source: 'kind' };
  return { price: cfg.plantByContainer[inst.container] ?? 0, source: 'default' };
}

/** What a plant costs by default: the container price, with no species price set. */
export const defaultPlantPrice = (container: string, cfg: PricingCfg): number => cfg.plantByContainer[container] ?? 0;

export interface PlantCostRow {
  speciesId: string;
  container: string;
  quantity: number;
  /** Average price each, which differs from the species price only when some plants carry their own. */
  unitPrice: number;
  total: number;
}

/** Cost of the new plants, grouped like the plant schedule (species and container). Existing plants cost nothing. */
export function plantCosts(plants: PlacedPlant[], prices: Prices, cfg: PricingCfg): { rows: PlantCostRow[]; total: number } {
  const rows = new Map<string, PlantCostRow>();
  for (const p of plants) {
    if (p.inst.existing) continue;
    const key = `${p.species.id}|${p.inst.container}`;
    const r = rows.get(key) ?? { speciesId: p.species.id, container: p.inst.container, quantity: 0, unitPrice: 0, total: 0 };
    r.quantity++;
    r.total += plantPrice(p.inst, p.species, prices, cfg).price;
    rows.set(key, r);
  }
  const list = [...rows.values()].map((r) => ({ ...r, unitPrice: r.quantity ? r.total / r.quantity : 0 }));
  return { rows: list, total: list.reduce((a, r) => a + r.total, 0) };
}

/** The material's unit price: the owner's, else the stand-in. */
export const materialUnitPrice = (mat: Material, prices: Prices): number => prices.material[mat.id] ?? mat.price ?? 0;

export interface ElementPrice {
  /** Price per unit of the material's basis. */
  unit: number;
  basis: 'sf' | 'lf' | 'each';
  /** How many units: square feet, linear feet, or 1. */
  quantity: number;
  total: number;
  source: PriceSource;
}

/**
 * What one hardscape element costs: its own price when the owner gave one, else the material's unit price times its
 * area, its length (walls, fences) or one (a table, a grill).
 */
export function elementPrice(el: HardscapeElement, mat: Material, cfg: EngineConfig['hardscape'], prices: Prices): ElementPrice {
  const basis = mat.priceBasis ?? (mat.unit === 'lf' ? 'lf' : 'sf');
  const m = elementMetrics(el, mat, cfg);
  const quantity = basis === 'each' ? 1 : basis === 'lf' ? m.edgeLf : m.areaSf;
  const unit = materialUnitPrice(mat, prices);
  if (el.price !== undefined) return { unit, basis, quantity, total: el.price, source: 'item' };
  return { unit, basis, quantity, total: unit * quantity, source: prices.material[mat.id] !== undefined ? 'kind' : 'default' };
}

export interface HardscapeCostRow {
  materialId: string;
  name: string;
  basis: 'sf' | 'lf' | 'each';
  count: number;
  quantity: number;
  /** Total over unit quantity, which is the material's price unless some elements carry their own. */
  unitPrice: number;
  total: number;
}

/** Cost of new hardscape by material (existing and removed work is not counted), with a total. */
export function hardscapeCosts(elements: HardscapeElement[], materials: Material[], cfg: EngineConfig['hardscape'], prices: Prices): { rows: HardscapeCostRow[]; total: number } {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rows = new Map<string, HardscapeCostRow>();
  for (const el of elements) {
    if (el.existing || el.removed) continue;
    const mat = byId.get(el.materialId);
    if (!mat) continue;
    const p = elementPrice(el, mat, cfg, prices);
    const r = rows.get(mat.id) ?? { materialId: mat.id, name: mat.name, basis: p.basis, count: 0, quantity: 0, unitPrice: 0, total: 0 };
    r.count++;
    r.quantity += p.quantity;
    r.total += p.total;
    rows.set(mat.id, r);
  }
  const list = [...rows.values()].map((r) => ({ ...r, unitPrice: r.quantity ? r.total / r.quantity : 0 })).sort((a, b) => a.name.localeCompare(b.name));
  return { rows: list, total: list.reduce((a, r) => a + r.total, 0) };
}

export const money = (n: number, cfg: Pick<PricingCfg, 'currency'>): string =>
  `${cfg.currency}${Math.round(n).toLocaleString('en-US')}`;

export const money2 = (n: number, cfg: Pick<PricingCfg, 'currency'>): string =>
  `${cfg.currency}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The whole project's estimated cost: plants, hardscape and the sum. */
export function projectCost(plants: PlacedPlant[], elements: HardscapeElement[], materials: Material[], engine: EngineConfig, prices: Prices) {
  const p = plantCosts(plants, prices, engine.pricing);
  const h = hardscapeCosts(elements, materials, engine.hardscape, prices);
  return { plants: p.total, hardscape: h.total, total: p.total + h.total };
}

export const priceLabel: Record<'sf' | 'lf' | 'each', string> = { sf: 'sq ft', lf: 'lin ft', each: 'each' };
