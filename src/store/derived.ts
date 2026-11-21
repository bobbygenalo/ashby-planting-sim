import { useMemo } from 'react';
import { pointInPolygon } from '../engine/geometry';
import { placedPlants, type PlacedPlant } from '../engine/growth';
import { waterDemand } from '../engine/water';
import { useApp } from './store';

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
      }),
    [plants, hardscape, hydrozones, autoIrrigation, site, water, engine, month, useRain],
  );
}

/** Id of the yard zone containing a point, or null. */
export function zoneIdAt(zones: { id: string; polygon: [number, number][] }[], x: number, y: number): string | null {
  return zones.find((z) => pointInPolygon(x, y, z.polygon))?.id ?? null;
}
