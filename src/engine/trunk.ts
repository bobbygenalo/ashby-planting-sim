import type { TrunkCfg } from './types';

/** Radius of the trunk just above its flare, feet: in proportion to the plant's whole height, within limits. */
export function trunkBaseRadius(totalH: number, cfg: TrunkCfg): number {
  return Math.min(cfg.maxRadiusFt, Math.max(cfg.minRadiusFt, cfg.radiusPerHeight * totalH));
}

/** Radius at the top of a trunk, where the limbs begin. */
export function trunkTopRadius(totalH: number, cfg: TrunkCfg): number {
  return trunkBaseRadius(totalH, cfg) * cfg.topRatio;
}

/** Radius of the trunk at height `z` of a trunk `trunkH` tall: tapering toward the top, and flared out at the ground. */
export function trunkRadiusAt(z: number, trunkH: number, totalH: number, cfg: TrunkCfg): number {
  const u = Math.min(1, Math.max(0, z / Math.max(trunkH, 1e-6)));
  const rb = trunkBaseRadius(totalH, cfg);
  const taper = 1 - (1 - cfg.topRatio) * u;
  const flare = 1 + (cfg.flare - 1) * Math.exp(-u / Math.max(cfg.flareHeightFrac, 1e-3));
  return rb * taper * flare;
}

/** Bark ridges: a factor close to 1 that varies around the trunk and slowly along it, as the grain twists. */
export function barkRidge(az: number, z: number, seed: number, cfg: TrunkCfg): number {
  const phase = (seed % 97) * 0.37;
  const twist = Math.sin(z * 0.55 + phase) * 1.4;
  const main = Math.sin(cfg.ridges * az + twist + phase);
  const fine = Math.sin(cfg.ridges * 2.7 * az - twist * 0.6 + phase * 2) * 0.35;
  return 1 + cfg.ridgeAmp * (main + fine) / 1.35;
}

/** Sideways wander of the trunk's center line at height `z`, feet: a gentle sinuous curve that dies away at the top. */
export function trunkCenter(z: number, trunkH: number, seed: number, cfg: TrunkCfg): [number, number] {
  const u = Math.min(1, Math.max(0, z / Math.max(trunkH, 1e-6)));
  const fade = (1 - u) ** 1.2 * Math.sin(Math.PI * Math.min(1, u * 1.6));
  const amp = cfg.sway * trunkH;
  const a = (seed % 360) * (Math.PI / 180);
  return [Math.cos(a) * amp * fade, Math.sin(a) * amp * fade];
}
