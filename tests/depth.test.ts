import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { layeredThickness, overlayHeightFt } from '../src/engine/hardscape';
import { loadSite } from '../src/engine/site';
import { depthBias } from '../src/scene/overlay';
import type { EngineConfig, HardscapeElement } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.hardscape;
const site = loadSite(siteRaw);

describe('flat overlays sit above every flat surface', () => {
  it('is above the top of the tallest flat element, by the gap, for the plan as it stands', () => {
    const els = site.hardscape as HardscapeElement[];
    const base = overlayHeightFt(els, cfg);
    const tops = [...layeredThickness(els, cfg).values()].map((t) => cfg.groundLiftFt + t);
    for (const top of tops) expect(base).toBeGreaterThanOrEqual(top + cfg.overlayGapFt - 1e-9);
    expect(base).toBeGreaterThan(cfg.groundLiftFt + Math.max(...Object.values(cfg.surfaceThicknessFt)));
  });

  it('rises as flat elements are stacked, and never sits level with any of their tops', () => {
    const box = (x: number): [number, number][] => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]];
    const stack = Array.from({ length: 8 }, (_, i): HardscapeElement => ({ id: `s${i}`, type: 'patio', points: box(i), materialId: 'concrete', height: 0, depthIn: 3, width: 0, existing: false }));
    const base = overlayHeightFt(stack, cfg);
    const tops = [...layeredThickness(stack, cfg).values()].map((t) => cfg.groundLiftFt + t);
    expect(base).toBeGreaterThan(Math.max(...tops));
    for (const top of tops) expect(Math.abs(base - top)).toBeGreaterThan(cfg.overlayGapFt - 1e-9);
    expect(overlayHeightFt(stack, cfg)).toBeGreaterThan(overlayHeightFt([], cfg));
  });
});

describe('surfaces of a building that lie in one plane', () => {
  it('lets a roof win over any wall, and a slab over any roof, whatever the order of the parts', () => {
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      expect(depthBias(1, i).polygonOffsetUnits, `roof ${i} over wall ${j}`).toBeLessThan(depthBias(0, j).polygonOffsetUnits);
      expect(depthBias(2, i).polygonOffsetUnits, `slab ${i} over roof ${j}`).toBeLessThan(depthBias(1, j).polygonOffsetUnits);
      expect(depthBias(2, i).polygonOffsetFactor).toBeLessThan(depthBias(1, j).polygonOffsetFactor);
    }
  });

  it('lets a later part win over an earlier one of the same kind, and keeps the pull toward the camera small', () => {
    for (const kind of [0, 1, 2]) for (let i = 1; i < 40; i++) expect(depthBias(kind, i).polygonOffsetUnits).toBeLessThan(depthBias(kind, i - 1).polygonOffsetUnits);
    expect(Math.abs(depthBias(2, 39).polygonOffsetUnits)).toBeLessThan(110); // a fraction of an inch at any distance the camera works from
  });

  it('has the ADU\'s fins end at the shed slope the slab above them follows, which is why the two faces share a plane and need the bias', () => {
    const fin = site.structures.find((s) => s.id === 'adu-fin-great-e')!, slab = site.structures.find((s) => s.id === 'adu-great')!;
    // the fin\'s roof rises to the same height as the great room\'s slab at that end, within an inch
    expect(Math.abs(fin.ridgeHeight - slab.ridgeHeight)).toBeLessThan(0.1);
    expect(slab.roofThickness).toBeGreaterThan(0);
  });
});
