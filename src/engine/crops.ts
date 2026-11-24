import { distanceToSegment, pointInPolygon } from './geometry';
import { PRODUCE_REACH } from './cropPlants';
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
/** How far a point is from the nearest edge of a polygon, whether it is inside or out. */
function edgeDistance(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]).dist);
  return best;
}

export function cropPositions(poly: Pt[], spacing: number, cfg: CropCfg, inset = cfg.insetFt): Pt[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) + inset, Math.max(...xs) - inset, Math.min(...ys) + inset, Math.max(...ys) - inset];
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
        // Inside the bed and a margin from its walls, so nothing is rooted in a board at the notch of an L or U.
        if (pointInPolygon(p[0], p[1], poly) && edgeDistance(p, poly) >= inset * 0.5) out.push(p);
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

/**
 * How wide one plant is as drawn, in feet: its canopy, or its produce with the display scale the scene uses, whichever is
 * wider. A carrot's root is drawn about half a foot across, far wider than a real one, so it sets the limit.
 */
export function cropFootprintFt(crop: Crop, cfg: CropCfg): { canopy: number; produce: number } {
  const pr = crop.produce;
  const produce = pr ? Math.max(pr.sizeFt * cfg.produceDisplayScale, cfg.produceMinFt) * 2 * PRODUCE_REACH[pr.shape][1] : 0;
  return { canopy: crop.widthFt, produce };
}

/**
 * How far apart plants of a crop stand in a bed. Extension guides give a spacing for each crop (3 in for carrots at 16 to
 * a square foot, 6 to 9 in for lettuce, 18 in for broccoli, and so on), kept here as `spacingFt`; but the plants are
 * drawn larger than life, so they are never set closer than the drawn plants allow: the canopies may touch, and drawn
 * produce keeps a gap of its own, so nothing is drawn on top of its neighbor.
 */
export function cropSpacingFt(crop: Crop, cfg: CropCfg): number {
  const f = cropFootprintFt(crop, cfg);
  return Math.max(crop.spacingFt, f.canopy * cfg.canopyShare, f.produce * cfg.produceGapShare);
}

/** How far plants of a crop stand from a bed's walls: at least the usual margin, and half their own drawn width, so none leans over a board. */
export function cropInsetFt(crop: Crop, cfg: CropCfg): number {
  const f = cropFootprintFt(crop, cfg);
  return Math.max(cfg.insetFt, Math.min(Math.max(f.canopy, f.produce) / 2, cfg.insetFt * 2.5));
}

/** Where the plants of a crop stand in a bed: on a grid at its spacing, clear of the walls. */
export function cropSpots(poly: Pt[], crop: Crop, cfg: CropCfg): Pt[] {
  return cropPositions(poly, cropSpacingFt(crop, cfg), cfg, cropInsetFt(crop, cfg));
}
