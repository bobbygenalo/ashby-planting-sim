import { buildFoliage, type Foliage } from './foliage';
import { mulberry32 } from './shuffle';
import type { BranchCfg, Crop, CropCfg, FoliageCfg, Habit } from './types';

type Vec3 = [number, number, number];

/** One piece of produce: where it joins the plant, which way it points away from there, and its length in feet. */
export interface ProduceSpec {
  p: Vec3;
  dir: Vec3;
  size: number;
  /** Turn about its own axis. */
  roll: number;
  /** Slight variation, 0 to 1. */
  shade: number;
}

export interface CropPlant {
  foliage: Foliage;
  produce: ProduceSpec[];
}

/** The outline each growth form fills, for the foliage builder. */
const HABIT: Record<Crop['form'], Habit> = { rosette: 'round', bush: 'round', upright: 'columnar', vine: 'columnar', mound: 'spreading' };

/** How far each produce shape reaches from where it joins the plant, in multiples of its size, and half its thickness. */
const REACH: Record<NonNullable<Crop['produce']>['shape'], [number, number]> = {
  sphere: [0.9, 0.5], pepper: [1.7, 0.4], eggplant: [1.9, 0.43], zucchini: [2.3, 0.46], cucumber: [2.1, 0.31], pod: [2.4, 0.12], head: [0.7, 0.4], berry: [1, 0.46], carrot: [0.3, 0.5],
};

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * One crop plant at full size, from its data: leaves and stems like the garden plants, plus its produce where it
 * grows (hanging from the stems, at the middle of a rosette, on the ground, or round the edge). Deterministic for a
 * seed; the scene draws it smaller for a seedling.
 */
export function buildCropPlant(crop: Crop, seed: number, branches: BranchCfg, foliage: FoliageCfg, cfg: CropCfg): CropPlant {
  const r = crop.widthFt / 2, h = crop.heightFt;
  const fol = buildFoliage(crop.look, { habit: HABIT[crop.form], r, base: 0, canopyH: h, matureR: r, matureH: h, seed, branches, cfg: foliage });
  const produce: ProduceSpec[] = [];
  const pr = crop.produce;
  if (pr) {
    const rng = mulberry32((seed ^ 0x51ed270b) >>> 0);
    const size = Math.max(pr.sizeFt * cfg.produceDisplayScale, cfg.produceMinFt);
    const segs = fol.skeleton?.segments ?? [];
    for (let i = 0; i < pr.count; i++) {
      const az = rng() * Math.PI * 2;
      let p: Vec3, dir: Vec3;
      switch (pr.place) {
        case 'stems': {
          // Hanging from a stem, on its upper part.
          const s = segs[Math.floor(rng() * segs.length)];
          const t = 0.4 + 0.6 * rng();
          p = s ? [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t] : [0, 0, h * 0.6];
          dir = norm([Math.cos(az) * 0.15, Math.sin(az) * 0.15, -1]);
          break;
        }
        case 'center': {
          // A head at the top of the plant, facing up.
          p = [(rng() - 0.5) * r * 0.15, (rng() - 0.5) * r * 0.15, h * 0.5];
          dir = [0, 0, 1];
          break;
        }
        case 'edge': {
          // Berries hang over the edge of the mound, low.
          const rr = r * (0.45 + 0.4 * rng());
          p = [Math.cos(az) * rr, Math.sin(az) * rr, Math.min(h * 0.35, size * 1.6)];
          dir = norm([Math.cos(az) * 0.5, Math.sin(az) * 0.5, -1]);
          break;
        }
        default: {
          // On the ground near the middle: lying down, or a root's shoulder poking up.
          const rr = r * 0.5 * Math.sqrt(rng());
          p = [Math.cos(az) * rr, Math.sin(az) * rr, pr.shape === 'carrot' ? 0 : size * 0.22];
          dir = pr.shape === 'carrot' ? [0, 0, 1] : [Math.cos(az), Math.sin(az), 0.05];
        }
      }
      dir = norm(dir);
      // Nothing hangs or lies below the soil: lift it until its far end and its thickness clear the ground.
      const [len, half] = REACH[pr.shape];
      const lowest = Math.min(p[2], p[2] + dir[2] * len * size) - half * size * (1 - Math.abs(dir[2]));
      if (lowest < 0.01) p = [p[0], p[1], p[2] + (0.01 - lowest)];
      produce.push({ p, dir, size, roll: rng() * Math.PI * 2, shade: rng() });
    }
  }
  return { foliage: fol, produce };
}
