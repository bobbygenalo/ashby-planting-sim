import { sunVectorSite } from './solar';
import type { SiteConfig } from './types';

/** The plan sheet prints at 1 inch = 20 feet, the scale of the original plot plan. */
export const SHEET_SCALE_FT_PER_IN = 20;

export const feetToInches = (ft: number, ftPerIn = SHEET_SCALE_FT_PER_IN) => ft / ftPerIn;

/**
 * Angle to turn the north arrow, in degrees clockwise from straight up, on a sheet that draws the rear of the lot
 * at the top and X to the right. With the rear bearing 330 degrees, north is 30 degrees clockwise of up.
 */
export function northAngleDeg(site: Pick<SiteConfig, 'rearBearingDeg' | 'driveSide'>): number {
  const [x, y] = sunVectorSite(site.rearBearingDeg, site.driveSide, 0, 0);
  return (Math.atan2(x, y) * 180) / Math.PI;
}

/** Scale bar divisions in feet: 0, 10, 20 at this scale. */
export function scaleBarFeet(lengthFt = 20, step = 10): number[] {
  const out: number[] = [];
  for (let f = 0; f <= lengthFt + 1e-9; f += step) out.push(f);
  return out;
}

/** Letter keys A, B, ... Z, AA, AB for the plan-to-schedule cross reference. */
export function planKey(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * The size of the key letter inside a plant's circle on the sheet, in feet: about the circle's own width, never bigger than
 * the sheet's text and never so small it cannot be read, so a small plant's letter fits in its circle.
 */
export function planKeySize(textFt: number, circleRadiusFt: number): number {
  return Math.min(textFt * 0.9, Math.max(circleRadiusFt * 0.95, textFt * 0.5));
}
