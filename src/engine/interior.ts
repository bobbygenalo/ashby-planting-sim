/**
 * Interior lights: how brightly the windows of a building glow, from 0 (off) to 1. Lights come on as the sun gets low (each building a
 * little earlier or later than the next, so a street of houses does not switch on at one instant), stay on through the evening, go
 * out when the household goes to bed and come back on before dawn if the sun is still down.
 */
export interface InteriorCfg {
  /** The sun's height at which lights begin to come on, and at which they are fully on, in degrees. */
  startDeg: number;
  fullDeg: number;
  /** Each building's own start is moved by up to this many degrees either way. */
  staggerDeg: number;
  /** Lights are out from this minute of the day to the next morning's `sleepToMin`. */
  sleepFromMin: number;
  sleepToMin: number;
  color: string;
  /** Emissive strength of lit glass at full glow. */
  emissive: number;
  /** The round outdoor lights: the sun's height at which they begin to come on and are fully on, how strongly the bulb glows, and the glow round it (opacity). */
  outdoorStartDeg: number;
  outdoorFullDeg: number;
  outdoorEmissive: number;
  haloOpacity: number;
}

/** A small stable number in [0, 1) from a name, so each building keeps its own offset. */
export function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function interiorLight(sunElevationDeg: number, minuteOfDay: number, cfg: InteriorCfg, seed: number): number {
  if (minuteOfDay >= cfg.sleepFromMin || minuteOfDay < cfg.sleepToMin) return 0;
  const start = cfg.startDeg + (seed - 0.5) * 2 * cfg.staggerDeg;
  const t = Math.min(1, Math.max(0, (start - sunElevationDeg) / (start - cfg.fullDeg)));
  return t * t * (3 - 2 * t);
}

/**
 * Outdoor lights (the round lights by the doors): off in daylight, on from dusk, and on all night until the sun is up again, unlike the
 * windows, which go dark when the household goes to bed.
 */
export function outdoorLight(sunElevationDeg: number, cfg: InteriorCfg): number {
  const t = Math.min(1, Math.max(0, (cfg.outdoorStartDeg - sunElevationDeg) / (cfg.outdoorStartDeg - cfg.outdoorFullDeg)));
  return t * t * (3 - 2 * t);
}
