import type { PlantSize } from './growth';
import { canopyRadius, type CrownProfile } from './canopy';
import { mulberry32 } from './shuffle';
import type { FruitCfg, Habit, Species } from './types';

export interface FruitState {
  phase: 'ripe' | 'unripe';
  color: string;
  /** Number of fruit to draw. */
  count: number;
  /** Drawn diameter in feet, already scaled up so it reads from a distance. */
  diameterFt: number;
  /** Vertical stretch (1 for round fruit). */
  aspect: number;
}

/** How grown a plant is, as the smaller of its height and width shares of mature size, capped at 1. */
export function sizeFraction(sp: Species, size: PlantSize): number {
  return Math.min(1, size.height / sp.matureHeight, size.width / sp.matureWidth);
}

/**
 * What fruit a plant shows: none until it is big enough to fruit, none out of season, green and smaller while
 * unripe, full color when ripe, and more of it as the plant grows toward full size. Deciduous plants keep ripe
 * fruit on bare branches (persimmons do), so leaf drop does not hide it.
 */
export function fruitState(sp: Species, size: PlantSize, month: number, cfg: FruitCfg): FruitState | null {
  const f = sp.fruit;
  if (!f || !size.planted) return null;
  const frac = sizeFraction(sp, size);
  if (frac < cfg.minSizeFraction) return null;
  const ripe = f.ripeMonths.includes(month);
  const unripe = !ripe && (f.unripeMonths ?? []).includes(month);
  if (!ripe && !unripe) return null;
  const ramp = (frac - cfg.minSizeFraction) / (1 - cfg.minSizeFraction);
  const count = Math.min(cfg.maxCount, Math.max(1, Math.round(f.count * (cfg.startCountFraction + (1 - cfg.startCountFraction) * ramp))));
  return {
    phase: ripe ? 'ripe' : 'unripe',
    color: ripe ? f.ripeColor : f.unripeColor ?? f.ripeColor,
    count,
    diameterFt: Math.max(f.diameterFt * (f.displayScale ?? cfg.displayScale), f.minDisplayFt ?? cfg.minDisplayDiameterFt) * (ripe ? 1 : cfg.unripeScale),
    aspect: f.shape === 'oval' ? f.aspect ?? 1.3 : 1,
  };
}

/** A stable number from an id, so a plant's fruit sits in the same places every time. */
export function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Where fruit hangs: points on the canopy surface in the plant's own frame (feet from its trunk, z up), spread
 * evenly around and up the canopy with a little jitter, the same every time for the same seed.
 */
export function fruitPositions(habit: Habit, r: number, base: number, canopyH: number, count: number, seed: number, cfg: FruitCfg, profile?: CrownProfile): [number, number, number][] {
  const rng = mulberry32(seed);
  const [z0, z1] = cfg.zFractionRange;
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    // Even coverage: height by area, angle by the golden angle, then a little jitter.
    const zf = z0 + (z1 - z0) * (0.5 + (t - 0.5) * (0.85 + 0.3 * rng()));
    const phi = i * 2.399963229728653 + (rng() - 0.5) * 0.6;
    const rho = canopyRadius(habit, r, zf, base <= 0.02, profile) * cfg.insetFraction;
    out.push([Math.cos(phi) * rho, Math.sin(phi) * rho, base + zf * canopyH]);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct to Nov" style label for a run of months (wraps over the new year). */
export function monthRange(months: number[]): string {
  if (months.length === 0) return 'none';
  const set = new Set(months);
  const start = months.find((m) => !set.has(m === 1 ? 12 : m - 1)) ?? months[0];
  let end = start;
  while (set.has(end === 12 ? 1 : end + 1) && end !== start - 1) end = end === 12 ? 1 : end + 1;
  return start === end ? MONTHS[start - 1] : `${MONTHS[start - 1]} to ${MONTHS[end - 1]}`;
}
