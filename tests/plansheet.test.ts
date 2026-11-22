import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { feetToInches, northAngleDeg, planKey, planKeySize, scaleBarFeet } from '../src/engine/plansheet';
import { loadSite } from '../src/engine/site';

const site = loadSite(siteRaw);

describe('plan sheet', () => {
  it('prints at 1 inch = 20 feet, so the whole lot fits a letter page', () => {
    expect(feetToInches(20)).toBe(1);
    expect(feetToInches(site.lot.depth)).toBeCloseTo(7.52, 2);
    expect(feetToInches(site.lot.width)).toBeCloseTo(2.53, 2);
    expect(feetToInches(site.lot.depth + 20)).toBeLessThan(9); // with room for dimensions and a title
  });
  it('turns the north arrow from the lot\'s bearing, with the rear at the top', () => {
    expect(northAngleDeg({ rearBearingDeg: 330, driveSide: 'left' })).toBeCloseTo(30, 6);
    expect(northAngleDeg({ rearBearingDeg: 330, driveSide: 'right' })).toBeCloseTo(-30, 6);
    expect(northAngleDeg({ rearBearingDeg: 0, driveSide: 'left' })).toBeCloseTo(0, 6);
    expect(Math.abs(northAngleDeg({ rearBearingDeg: 180, driveSide: 'left' }))).toBeCloseTo(180, 6);
    expect(northAngleDeg(site)).toBeCloseTo(30, 6);
  });
  it('labels the scale bar and keys plants A, B, ... Z, AA', () => {
    expect(scaleBarFeet()).toEqual([0, 10, 20]);
    expect([0, 1, 25, 26, 27, 51, 52].map(planKey)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('the key letter in a plant circle', () => {
  it('is smaller than the circle for the smallest plants, bigger and capped for large ones, and always legible', () => {
    const text = 2.3; // 8 pt on the sheet, in feet
    expect(planKeySize(text, 0.8)).toBeLessThan(0.8 * 2); // fits inside the smallest circle's width
    expect(planKeySize(text, 0.8)).toBeGreaterThanOrEqual(text * 0.5);
    expect(planKeySize(text, 5)).toBe(text * 0.9); // large plants keep the usual size
    for (const r of [0.8, 1.2, 2, 4, 8]) {
      const k = planKeySize(text, r);
      expect(k).toBeLessThanOrEqual(text * 0.9);
      expect(k).toBeGreaterThanOrEqual(text * 0.5);
    }
    expect(planKeySize(text, 1.5)).toBeGreaterThanOrEqual(planKeySize(text, 0.8)); // never shrinks as the circle grows
  });
});
