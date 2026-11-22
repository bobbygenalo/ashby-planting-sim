import type { PlacedPlant } from './growth';
import { formatFeetInches } from './units';
import { plantPrice } from './pricing';
import type { EngineConfig, Prices, PricingCfg, WaterConfig } from './types';

export interface ScheduleRow {
  speciesId: string;
  common: string;
  botanical: string;
  quantity: number;
  container: string;
  spacingFt: number;
  water: string;
  sun: string;
  /** Average price of one, and of all of them, in dollars (0 until priced). */
  unitPrice: number;
  total: number;
}

/** Plant schedule for buying and planting (OUT-1): new plants only, grouped by species and container. */
export function plantSchedule(plants: PlacedPlant[], growth: EngineConfig['growth'], water: WaterConfig, pricing?: { prices: Prices; cfg: PricingCfg }): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const p of plants) {
    if (p.inst.existing) continue;
    const key = `${p.species.id}|${p.inst.container}`;
    const r = rows.get(key) ?? {
      speciesId: p.species.id, common: p.species.common, botanical: p.species.botanical, quantity: 0,
      container: growth.containers[p.inst.container].label, spacingFt: p.species.matureWidth * water.outputs.spacingFactor,
      water: p.species.wucols, sun: p.species.sun, unitPrice: 0, total: 0,
    };
    r.quantity++;
    if (pricing) r.total += plantPrice(p.inst, p.species, pricing.prices, pricing.cfg).price;
    rows.set(key, r);
  }
  for (const r of rows.values()) r.unitPrice = r.quantity ? r.total / r.quantity : 0;
  return [...rows.values()].sort((a, b) => a.common.localeCompare(b.common) || a.container.localeCompare(b.container));
}

export function scheduleCsv(rows: ScheduleRow[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ['Species', 'Common name', 'Quantity', 'Container', 'Spacing', 'Water use', 'Sun need', 'Price each (USD)', 'Total (USD)'];
  const lines = rows.map((r) => [q(r.botanical), q(r.common), r.quantity, q(r.container), q(formatFeetInches(r.spacingFt, 2)), q(r.water), q(r.sun), r.unitPrice.toFixed(2), r.total.toFixed(2)].join(','));
  lines.push([q('Total'), q(''), rows.reduce((a, r) => a + r.quantity, 0), q(''), q(''), q(''), q(''), q(''), rows.reduce((a, r) => a + r.total, 0).toFixed(2)].join(','));
  return [head.map(q).join(','), ...lines].join('\n');
}
