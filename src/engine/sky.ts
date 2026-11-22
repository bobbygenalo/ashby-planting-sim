import type { EngineConfig } from './types';

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const mix = (a: [number, number, number], b: [number, number, number], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Background color for a sun elevation: day above `fullDayElevationDeg`, a warm glow at `duskElevationDeg`, night below `fullNightElevationDeg`. */
export function skyColor(elevationDeg: number, cfg: EngineConfig['sky']): string {
  const day = hex(cfg.day), dusk = hex(cfg.dusk), night = hex(cfg.night);
  let c: number[];
  if (elevationDeg >= cfg.fullDayElevationDeg) c = day;
  else if (elevationDeg >= cfg.duskElevationDeg) c = mix(dusk, day, (elevationDeg - cfg.duskElevationDeg) / (cfg.fullDayElevationDeg - cfg.duskElevationDeg));
  else if (elevationDeg > cfg.fullNightElevationDeg) c = mix(night, dusk, (elevationDeg - cfg.fullNightElevationDeg) / (cfg.duskElevationDeg - cfg.fullNightElevationDeg));
  else c = night;
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
