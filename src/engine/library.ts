import type { PlantInstance, PlantType, PollinatorGroup, PollinatorValue, Species } from './types';

export interface LibraryFilter {
  text?: string;
  type?: PlantType;
  origin?: Species['origin'];
  water?: Species['wucols'];
  sun?: Species['sun'];
  evergreen?: boolean;
  pollinator?: PollinatorValue;
  group?: PollinatorGroup;
  bloomMonth?: number;
  nonToxicOnly?: boolean;
  hideInvasive?: boolean;
}

/** Filter and search the library (PL-3, POL-2). Every field narrows the result. */
export function filterSpecies(all: Species[], f: LibraryFilter): Species[] {
  const q = f.text?.trim().toLowerCase();
  return all.filter(
    (s) =>
      (!q || s.common.toLowerCase().includes(q) || s.botanical.toLowerCase().includes(q)) &&
      (!f.type || s.type === f.type) &&
      (!f.origin || s.origin === f.origin) &&
      (!f.water || s.wucols === f.water) &&
      (!f.sun || s.sun === f.sun) &&
      (f.evergreen === undefined || s.evergreen === f.evergreen) &&
      (!f.pollinator || s.pollinator.value === f.pollinator) &&
      (!f.group || s.pollinator.groups.includes(f.group)) &&
      (!f.bloomMonth || s.bloomMonths.includes(f.bloomMonth)) &&
      (!f.nonToxicOnly || !s.toxic) &&
      (!f.hideInvasive || !s.invasive),
  );
}

/**
 * Every placed plant is part of the scenario. The palette is only the owner's star shortlist (a way to find
 * species quickly), so un-starring a species never hides plants already in the yard. The palette argument
 * is kept so callers do not change.
 */
export function activeInstances(instances: PlantInstance[], _palette?: Record<string, boolean>): PlantInstance[] {
  return instances;
}

export interface CustomSpeciesInput {
  common: string;
  botanical?: string;
  type: Species['type'];
  origin: Species['origin'];
  evergreen: boolean;
  matureHeight: number;
  matureWidth: number;
  yearsToMaturity: number;
  habit: Species['habit'];
  sun: Species['sun'];
  wucols: Species['wucols'];
  bloomMonths: number[];
  bloomColor: string;
  pollinatorValue: PollinatorValue;
  groups: PollinatorGroup[];
  invasive: boolean;
  toxic: boolean;
  notes?: string;
}

const DEFAULT_FOLIAGE: Record<Species['type'], string> = {
  tree: '#4f7d45', shrub: '#5f8f4f', perennial: '#7a9a6a', grass: '#8fae7a',
  groundcover: '#7bb06a', vine: '#4f7d45', succulent: '#7fb09a', edible: '#4f7d45',
};

/** Root clearances by plant size, used when the owner adds a species without root data. */
export function defaultRoots(type: Species['type'], matureHeight: number): Species['roots'] {
  switch (type) {
    case 'tree': return { behavior: 'moderate', minFoundationFt: 10, minPavingFt: 5 };
    case 'shrub': return { behavior: 'shallow', minFoundationFt: 3, minPavingFt: 1.5 };
    case 'groundcover': return { behavior: 'shallow', minFoundationFt: 0.5, minPavingFt: 0 };
    case 'vine': return { behavior: 'moderate', minFoundationFt: 3, minPavingFt: 2 };
    case 'edible': return matureHeight >= 8 ? { behavior: 'moderate', minFoundationFt: 8, minPavingFt: 4 } : { behavior: 'shallow', minFoundationFt: 3, minPavingFt: 1.5 };
    default: return { behavior: 'shallow', minFoundationFt: 1, minPavingFt: 0.5 };
  }
}

/** Validate owner input and build a Species record (PL-8). Pure, so the form stays thin. */
export function makeCustomSpecies(
  input: CustomSpeciesInput,
  existingIds: string[],
): { ok: true; species: Species } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input.common.trim()) errors.push('Enter a common name.');
  if (!(input.matureHeight > 0)) errors.push('Mature height must be more than 0.');
  if (!(input.matureWidth > 0)) errors.push('Mature width must be more than 0.');
  if (!(input.yearsToMaturity > 0)) errors.push('Years to maturity must be more than 0.');
  if (input.bloomMonths.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) errors.push('Bloom months must be 1 to 12.');
  if (errors.length) return { ok: false, errors };

  const slug = input.common.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = `custom-${slug}`;
  for (let n = 2; existingIds.includes(id); n++) id = `custom-${slug}-${n}`;
  const prov = { source: 'Entered by the owner', confidence: 'medium' as const };
  return {
    ok: true,
    species: {
      id,
      botanical: input.botanical?.trim() || input.common.trim(),
      common: input.common.trim(),
      type: input.type,
      origin: input.origin,
      evergreen: input.evergreen,
      leafOffMonths: input.evergreen ? [] : [12, 1, 2],
      matureHeight: input.matureHeight,
      matureWidth: input.matureWidth,
      yearsToMaturity: input.yearsToMaturity,
      habit: input.habit,
      sun: input.sun,
      wucols: input.wucols,
      bloomMonths: [...new Set(input.bloomMonths)].sort((a, b) => a - b),
      bloomColor: input.bloomColor,
      foliageColor: DEFAULT_FOLIAGE[input.type],
      pollinator: { value: input.pollinatorValue, groups: input.groups, larvalHost: [] },
      invasive: input.invasive,
      toxic: input.toxic,
      maintenance: 'moderate',
      notes: input.notes?.trim() || 'Custom species entered by the owner.',
      roots: defaultRoots(input.type, input.matureHeight),
      soil: { drainageNeed: 'moderate', textures: ['sandy loam', 'loam', 'silt loam', 'clay loam'], phMin: 6, phMax: 8 },
      provenance: { size: prov, light: prov, water: prov, pollinator: prov, soil: prov },
    },
  };
}
