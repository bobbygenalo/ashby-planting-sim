import { pointInPolygon } from './geometry';
import { mulberry32 } from './shuffle';
import type { CropCfg, Crop, CropPlan, Pt } from './types';

export interface CropStage {
  /** bare = pulled or not sown yet; growing = seedling to full size; harvest = full size with produce; spent = last month, fading; dormant = a perennial cut back. */
  phase: 'bare' | 'growing' | 'harvest' | 'spent' | 'dormant';
  /** Share of full size, 0 when bare. */
  size: number;
  /** Whether ripe produce shows. */
  produce: boolean;
  /** 0 for fresh leaves, up to 1 for fully faded. */
  fade: number;
}

const BARE: CropStage = { phase: 'bare', size: 0, produce: false, fade: 0 };
/** Months from `from` forward to `to`, wrapping the year (0 when equal). */
const ahead = (from: number, to: number) => (((to - from) % 12) + 12) % 12;

/** What a crop looks like in a calendar month: sown, growing, harvested, spent, then pulled; perennials cut back and regrow. */
export function cropStage(crop: Crop, month: number, cfg: CropCfg): CropStage {
  if (crop.perennial) {
    if (crop.dormantMonths?.includes(month)) return { phase: 'dormant', size: cfg.dormantFraction, produce: false, fade: 0.3 };
    const regrow = crop.regrowMonths?.includes(month);
    return { phase: 'growing', size: regrow ? cfg.regrowFraction : 1, produce: !!crop.fruitMonths?.includes(month), fade: 0 };
  }
  const at = ahead(crop.sowMonth, month);
  const last = ahead(crop.sowMonth, crop.endMonth);
  if (at > last) return BARE;
  const harvestAt = ahead(crop.sowMonth, crop.harvestStart);
  if (at < harvestAt) return { phase: 'growing', size: cfg.seedlingFraction + (1 - cfg.seedlingFraction) * (at / harvestAt), produce: false, fade: 0 };
  if (at === last && last > harvestAt) return { phase: 'spent', size: cfg.spentFraction, produce: true, fade: 1 };
  return { phase: 'harvest', size: 1, produce: true, fade: 0 };
}

/** Which season a month belongs to for rotation: the cool-season crop or the warm-season one. */
export function seasonOf(month: number, cfg: CropCfg): 'cool' | 'warm' {
  return cfg.seasons.cool.includes(month) ? 'cool' : 'warm';
}

/** The crop in a bed this month, or null. */
export function activeCrop(plan: CropPlan, crops: Crop[], month: number, cfg: CropCfg): { crop: Crop; stage: CropStage } | null {
  const crop = crops.find((c) => c.id === plan[seasonOf(month, cfg)]);
  if (!crop) return null;
  const stage = cropStage(crop, month, cfg);
  return stage.phase === 'bare' ? null : { crop, stage };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A bed's own plan when it has none: one cool-season and one warm-season crop, picked by bed id so beds differ. */
export function defaultCropPlan(bedId: string, crops: Crop[], index = 0): CropPlan {
  const pool = (season: Crop['season']) => crops.filter((c) => c.season === season);
  const pickOf = (list: Crop[], salt: string) => list[(hash(bedId + salt) + index) % list.length]?.id ?? '';
  return { cool: pickOf(pool('cool'), 'c'), warm: pickOf(pool('warm'), 'w') };
}

export const planOf = (bed: { id: string; crops?: CropPlan }, crops: Crop[], index = 0): CropPlan => bed.crops ?? defaultCropPlan(bed.id, crops, index);

/** Where plants stand: a grid at the crop's spacing inside the bed outline, widened when the bed would hold too many. */
export function cropPositions(poly: Pt[], spacing: number, cfg: CropCfg): Pt[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) + cfg.insetFt, Math.max(...xs) - cfg.insetFt, Math.min(...ys) + cfg.insetFt, Math.max(...ys) - cfg.insetFt];
  if (x1 <= x0 || y1 <= y0) return [];
  let sp = Math.max(spacing, 0.1);
  for (let tries = 0; tries < 12; tries++) {
    const nx = Math.max(1, Math.floor((x1 - x0) / sp) + 1), ny = Math.max(1, Math.floor((y1 - y0) / sp) + 1);
    if (nx * ny <= cfg.maxPlants) {
      const out: Pt[] = [];
      const ox = nx === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) - (nx - 1) * sp) / 2;
      const oy = ny === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) - (ny - 1) * sp) / 2;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p: Pt = [ox + i * sp, oy + j * sp];
        if (pointInPolygon(p[0], p[1], poly)) out.push(p);
      }
      return out;
    }
    sp *= 1.2;
  }
  return [];
}

/** Offsets (feet from a plant's center, plus a height share) where produce hangs, the same for a plant every season. */
export function produceOffsets(count: number, width: number, seed: number): [number, number, number][] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * width * 0.4;
    return [Math.cos(a) * r, Math.sin(a) * r, 0.25 + rng() * 0.6];
  });
}
