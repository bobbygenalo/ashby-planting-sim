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

/** Instances whose species is selected in the palette. Deselected ones are hidden, not deleted (PL-4). */
export function activeInstances(instances: PlantInstance[], palette: Record<string, boolean>): PlantInstance[] {
  return instances.filter((i) => palette[i.speciesId]);
}
