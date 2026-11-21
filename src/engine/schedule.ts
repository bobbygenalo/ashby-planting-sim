import type { PlacedPlant } from './growth';
import { formatFeetInches } from './units';
import type { EngineConfig, WaterConfig } from './types';

export interface ScheduleRow {
  speciesId: string;
  common: string;
  botanical: string;
  quantity: number;
  container: string;
  spacingFt: number;
  water: string;
  sun: string;
}

/** Plant schedule for buying and planting (OUT-1): new plants only, grouped by species and container. */
export function plantSchedule(plants: PlacedPlant[], growth: EngineConfig['growth'], water: WaterConfig): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const p of plants) {
    if (p.inst.existing) continue;
    const key = `${p.species.id}|${p.inst.container}`;
    const r = rows.get(key) ?? {
      speciesId: p.species.id, common: p.species.common, botanical: p.species.botanical, quantity: 0,
      container: growth.containers[p.inst.container].label, spacingFt: p.species.matureWidth * water.outputs.spacingFactor,
      water: p.species.wucols, sun: p.species.sun,
    };
    r.quantity++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.common.localeCompare(b.common) || a.container.localeCompare(b.container));
}

export function scheduleCsv(rows: ScheduleRow[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = ['Species', 'Common name', 'Quantity', 'Container', 'Spacing', 'Water use', 'Sun need'];
  const lines = rows.map((r) => [q(r.botanical), q(r.common), r.quantity, q(r.container), q(formatFeetInches(r.spacingFt, 2)), q(r.water), q(r.sun)].join(','));
  return [head.map(q).join(','), ...lines].join('\n');
}
