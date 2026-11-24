import type { CompanionCfg, Species } from './types';

const WATER = ['very low', 'low', 'moderate', 'high'];
const radius = (s: Species) => s.matureWidth / 2;

/** [hue 0-360, saturation 0-1, lightness 0-1] of a #rrggbb color. */
export function hsl(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Do two plants want the same watering and a light that suits both? Only then may they share a bed closely. */
export function compatible(a: Species, b: Species): boolean {
  if (WATER.indexOf(a.wucols) !== WATER.indexOf(b.wucols)) return false;
  return !((a.sun === 'full' && b.sun === 'shade') || (a.sun === 'shade' && b.sun === 'full'));
}

/** Do they set each other off: clearly different foliage tone, or contrasting blooms that open in the same month? */
export function contrasts(a: Species, b: Species, cfg: CompanionCfg): boolean {
  if (Math.abs(hsl(a.foliageColor)[2] - hsl(b.foliageColor)[2]) >= cfg.contrastLightness) return true;
  const shared = a.bloomMonths.some((m) => b.bloomMonths.includes(m));
  return shared && hueGap(hsl(a.bloomColor)[0], hsl(b.bloomColor)[0]) >= cfg.contrastHue;
}

/** Does the taller plant cast the kind of shade a full-sun plant would not want? */
export const castsShade = (s: Species, cfg: CompanionCfg) => s.type === 'tree' || s.matureHeight >= cfg.shadeHeightFt;

export type Pairing = 'apart' | 'drift' | 'layered' | 'contrast';

/**
 * How close two plants may stand, as the least distance between their centers in feet, and why. Normally their mature
 * crowns just touch (scaled by `allowance`), groundcovers included. A purposeful or
 * beautiful pair (see `CompanionCfg`) may stand closer, and a low plant may stand inside a tall one's crown, but never at its trunk.
 */
export function pairNeed(a: Species, b: Species, allowance: number, cfg?: CompanionCfg): { need: number; kind: Pairing } {
  const ra = radius(a), rb = radius(b);
  // Apart: crowns just touch, groundcovers included, so nothing stands on top of anything else.
  const apart = allowance * (ra + rb);
  if (!cfg || !compatible(a, b)) return { need: apart, kind: 'apart' };
  let best = { need: apart, kind: 'apart' as Pairing };
  if (a.id === b.id) {
    const need = cfg.driftSpacing * (ra + rb);
    if (need < best.need) best = { need, kind: 'drift' };
  }
  const [tall, low] = a.matureHeight >= b.matureHeight ? [a, b] : [b, a];
  if (tall.id !== low.id && tall.matureHeight >= cfg.layerHeightRatio * low.matureHeight) {
    // At the foot of a tall plant, under its crown: only where it really shades (a tree or a big shrub) and only for a plant that
    // likes shade. A low plant beside a low shrub stays out from under it. Fruit trees keep clear ground for picking, so nothing is layered under them.
    const need = Math.min(apart, radius(tall) * cfg.coreFraction);
    if (!tall.fruit && castsShade(tall, cfg) && low.sun !== 'full' && need < best.need) best = { need, kind: 'layered' };
  } else if (a.id !== b.id && contrasts(a, b, cfg)) {
    const need = cfg.contrastSpacing * (ra + rb);
    if (need < best.need) best = { need, kind: 'contrast' };
  }
  return best;
}
