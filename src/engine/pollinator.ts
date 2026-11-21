import type { PlacedPlant } from './growth';
import { sunFit } from './growth';
import { WATER_ORDER } from './water';
import type { EngineConfig, PollinatorGroup, PollinatorValue, Species, WaterConfig } from './types';

export interface BloomRow {
  species: Species;
  count: number;
  canopySf: number;
}

export interface BloomCalendar {
  rows: BloomRow[];
  /** Pollinator-weighted coverage score for each month (index 0 = January). */
  scores: number[];
  /** Species in bloom each month. */
  inBloom: Species[][];
  /** Months with no high-value plant in bloom. */
  gaps: number[];
}

/**
 * Bloom calendar (POL-3). A month's score adds, for every blooming species, its pollinator weight
 * times the number of plants (counted up to a cap). A gap is a month with no high-value bloom.
 */
export function bloomCalendar(plants: PlacedPlant[], cfg: WaterConfig['pollinator']): BloomCalendar {
  const bySpecies = new Map<string, BloomRow>();
  for (const p of plants) {
    const r = bySpecies.get(p.species.id) ?? { species: p.species, count: 0, canopySf: 0 };
    r.count++;
    r.canopySf += Math.PI * (p.size.width / 2) ** 2;
    bySpecies.set(p.species.id, r);
  }
  const rows = [...bySpecies.values()].sort((a, b) => a.species.common.localeCompare(b.species.common));
  const scores = new Array(12).fill(0) as number[];
  const inBloom: Species[][] = Array.from({ length: 12 }, () => []);
  for (const r of rows) {
    for (const m of r.species.bloomMonths) {
      scores[m - 1] += cfg.weights[r.species.pollinator.value] * Math.min(r.count, cfg.countCap);
      inBloom[m - 1].push(r.species);
    }
  }
  const gaps: number[] = [];
  for (let m = 0; m < 12; m++) {
    if (!inBloom[m].some((s) => s.pollinator.value === 'high')) gaps.push(m + 1);
  }
  return { rows, scores, inBloom, gaps };
}

export interface PollinatorSummary {
  plants: number;
  canopySf: number;
  byValue: Record<PollinatorValue, { plants: number; canopySf: number }>;
  nativePlants: number;
  nativeCanopySf: number;
  larvalHostPlants: number;
  groups: PollinatorGroup[];
}

/** Share of plants and canopy by pollinator value, native share, larval hosts and groups served (POL-4). */
export function pollinatorSummary(plants: PlacedPlant[]): PollinatorSummary {
  const s: PollinatorSummary = {
    plants: 0, canopySf: 0,
    byValue: { high: { plants: 0, canopySf: 0 }, moderate: { plants: 0, canopySf: 0 }, low: { plants: 0, canopySf: 0 } },
    nativePlants: 0, nativeCanopySf: 0, larvalHostPlants: 0, groups: [],
  };
  const groups = new Set<PollinatorGroup>();
  for (const p of plants) {
    const area = Math.PI * (p.size.width / 2) ** 2;
    s.plants++;
    s.canopySf += area;
    s.byValue[p.species.pollinator.value].plants++;
    s.byValue[p.species.pollinator.value].canopySf += area;
    if (p.species.origin === 'california native') {
      s.nativePlants++;
      s.nativeCanopySf += area;
    }
    if (p.species.pollinator.larvalHost.length > 0) s.larvalHostPlants++;
    p.species.pollinator.groups.forEach((g) => groups.add(g));
  }
  s.groups = [...groups];
  return s;
}

export interface GapSuggestion {
  species: Species;
  zones: { id: string; name: string; hours: number }[];
}

/**
 * Species that would fill a bloom gap (POL-5): high pollinator value, blooming in that month, not
 * invasive, not already placed, fitting the light in at least one yard zone, and within one water-use
 * step of what the scenario already irrigates (any water use if nothing is placed yet).
 */
export function gapSuggestions(args: {
  month: number;
  library: Species[];
  placedSpeciesIds: Set<string>;
  placedCategories: string[];
  zones: { id: string; name: string; meanHours: number; area: number }[];
  growth: EngineConfig['growth'];
  limit: number;
}): GapSuggestion[] {
  const catIdx = args.placedCategories.map((c) => WATER_ORDER.indexOf(c as (typeof WATER_ORDER)[number])).filter((i) => i >= 0);
  const out: GapSuggestion[] = [];
  for (const sp of args.library) {
    if (!sp.bloomMonths.includes(args.month) || sp.pollinator.value !== 'high' || sp.invasive || args.placedSpeciesIds.has(sp.id)) continue;
    if (catIdx.length > 0) {
      const mine = WATER_ORDER.indexOf(sp.wucols);
      if (!catIdx.some((c) => Math.abs(c - mine) <= 1)) continue;
    }
    const fits = args.zones
      .filter((z) => z.area > 0 && sunFit(sp, z.meanHours, args.growth) === 'ok')
      .map((z) => ({ id: z.id, name: z.name, hours: z.meanHours }));
    if (fits.length > 0) out.push({ species: sp, zones: fits });
  }
  return out.slice(0, args.limit);
}

export interface PollinatorWarning {
  kind: 'invasive' | 'play-area';
  message: string;
}

/** Warn about invasive species and bee-attracting groundcover in zones tagged as play areas (POL-6). */
export function pollinatorWarnings(
  plants: PlacedPlant[],
  zoneOf: (x: number, y: number) => string | null,
  zoneNames: Record<string, string>,
  playZones: Set<string>,
): PollinatorWarning[] {
  const out: PollinatorWarning[] = [];
  const seenInvasive = new Set<string>();
  const seenPlay = new Set<string>();
  for (const p of plants) {
    if (p.species.invasive && !seenInvasive.has(p.species.id)) {
      seenInvasive.add(p.species.id);
      out.push({ kind: 'invasive', message: `${p.species.common} is flagged invasive.` });
    }
    const zone = zoneOf(p.inst.position[0], p.inst.position[1]);
    const beeAttracting = p.species.pollinator.groups.some((g) => g === 'native bees' || g === 'honey bees');
    if (zone && playZones.has(zone) && p.species.type === 'groundcover' && beeAttracting) {
      const key = `${p.species.id}@${zone}`;
      if (!seenPlay.has(key)) {
        seenPlay.add(key);
        out.push({ kind: 'play-area', message: `${p.species.common} attracts bees and is placed in the play area (${zoneNames[zone] ?? zone}).` });
      }
    }
  }
  return out;
}
