import type { HardscapeElement, Pt, VehicleCfg } from './types';

/** Day of the week for a calendar date: 0 Sunday to 6 Saturday. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The sedan is home on the configured weekdays before it leaves (midnight to 7 am) and after it is back (7 pm to
 * midnight). `minutes` is the minute of the local day, so a Saturday morning is not a weekday evening.
 */
export function sedanHome(year: number, month: number, day: number, minutes: number, cfg: VehicleCfg): boolean {
  if (!cfg.weekdays.includes(weekdayOf(year, month, day))) return false;
  return minutes < cfg.awayFromMin || minutes >= cfg.backAtMin;
}

export interface SedanSpot {
  center: Pt;
  /** Direction the nose points, in radians (pi/2 is toward the rear of the lot). */
  heading: number;
  length: number;
  width: number;
  /** The ground it covers, as a rectangle. */
  poly: Pt[];
}

/** Where the polygon spans in X along the horizontal line at `y`. */
function spanAt(poly: Pt[], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

/**
 * Where the car stands: in the middle of the driveway's street end, nose toward the garage, its tail a little way in
 * from the street. Null when the driveway has been removed or is narrower than the car.
 */
export function sedanSpot(driveway: Pt[] | null, cfg: VehicleCfg): SedanSpot | null {
  if (!driveway || driveway.length < 3) return null;
  const y0 = Math.min(...driveway.map((p) => p[1])) + cfg.tailFromStreetFt;
  const y1 = y0 + cfg.lengthFt;
  let lo = -Infinity, hi = Infinity;
  for (const y of [y0 + 0.01, (y0 + y1) / 2, y1 - 0.01]) {
    const s = spanAt(driveway, y);
    if (!s) return null;
    lo = Math.max(lo, s[0]);
    hi = Math.min(hi, s[1]);
  }
  if (hi - lo < cfg.widthFt) return null;
  const cx = (lo + hi) / 2, cy = (y0 + y1) / 2, hw = cfg.widthFt / 2;
  return { center: [cx, cy], heading: Math.PI / 2, length: cfg.lengthFt, width: cfg.widthFt, poly: [[cx - hw, y0], [cx + hw, y0], [cx + hw, y1], [cx - hw, y1]] };
}

/** The car's spot for a plan: from the first driveway element still in it. */
export function sedanSpotFor(elements: HardscapeElement[], footprint: (e: HardscapeElement) => Pt[], cfg: VehicleCfg): SedanSpot | null {
  const el = elements.find((e) => e.keepClear && !e.removed);
  return el ? sedanSpot(footprint(el), cfg) : null;
}
