import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import soilRaw from '../src/data/soil.json';
import { raisedBedSoilTop } from '../src/engine/soil';
import type { EngineConfig, Pt } from '../src/engine/types';
import { raisedBedGeometry } from '../src/scene/raisedBed';

const frame = (engineRaw as unknown as EngineConfig).hardscape.raisedBedFrame;
const rect: Pt[] = [[10, 20], [14, 20], [14, 28], [10, 28]];
const bbox = (g: NonNullable<ReturnType<typeof raisedBedGeometry>['wood']>) => { g.computeBoundingBox(); return g.boundingBox!; };

describe('raised bed frames', () => {
  it('stacks boards between corner posts, with a cap, and the soil below the rim', () => {
    const b = raisedBedGeometry(rect, 1.5, raisedBedSoilTop(1.5, soilRaw.raisedBed.freeboardIn), '#8a6a47', frame, 3);
    expect(b.layers).toBe(Math.round((1.5 - frame.capThicknessFt) / frame.boardHeightFt));
    expect(b.wood).toBeTruthy();
    expect(b.soilZ).toBeCloseTo(1.5 - soilRaw.raisedBed.freeboardIn / 12, 9);
    expect(b.soilZ).toBeLessThan(1.5 - frame.capThicknessFt);
    const box = bbox(b.wood!);
    expect(box.min.z).toBeGreaterThanOrEqual(-1e-6);
    expect(box.max.z).toBeCloseTo(1.5 + frame.postRiseFt, 5); // the posts stand just above the cap
  });

  it('keeps the outside of the boards on the drawn outline, with only the cap overhanging it', () => {
    const box = bbox(raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 3).wood!);
    expect(box.min.x).toBeCloseTo(10 - frame.capOverhangFt, 5);
    expect(box.max.x).toBeCloseTo(14 + frame.capOverhangFt, 5);
    expect(box.min.y).toBeCloseTo(20 - frame.capOverhangFt, 5);
    expect(box.max.y).toBeCloseTo(28 + frame.capOverhangFt, 5);
  });

  it('builds the same frame whichever way the outline is wound, and never leans outward', () => {
    const cw = [...rect].reverse();
    const a = bbox(raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 3).wood!);
    const b = bbox(raisedBedGeometry(cw, 1.5, 1.25, '#8a6a47', frame, 3).wood!);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(b.min[k]).toBeCloseTo(a.min[k], 5);
      expect(b.max[k]).toBeCloseTo(a.max[k], 5);
    }
  });

  it('handles turned beds and other outlines', () => {
    const turned: Pt[] = rect.map(([x, y]) => [x * Math.cos(0.5) - y * Math.sin(0.5), x * Math.sin(0.5) + y * Math.cos(0.5)]);
    const tri: Pt[] = [[0, 0], [6, 0], [0, 5]];
    const L: Pt[] = [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]];
    for (const poly of [turned, tri, L]) {
      const b = raisedBedGeometry(poly, 1.5, 1.25, '#8a6a47', frame, 1);
      expect(b.wood).toBeTruthy();
      const pos = b.wood!.getAttribute('position').array;
      expect(Array.from(pos).every(Number.isFinite)).toBe(true);
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      const box = bbox(b.wood!);
      expect(box.min.x).toBeGreaterThanOrEqual(Math.min(...xs) - frame.capOverhangFt - frame.postFt);
      expect(box.max.x).toBeLessThanOrEqual(Math.max(...xs) + frame.capOverhangFt + frame.postFt);
      expect(box.min.y).toBeGreaterThanOrEqual(Math.min(...ys) - frame.capOverhangFt - frame.postFt);
      expect(box.max.y).toBeLessThanOrEqual(Math.max(...ys) + frame.capOverhangFt + frame.postFt);
    }
  });

  it('colors the boards a little differently and gives every vertex a color and a normal', () => {
    const b = raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 3);
    const col = b.wood!.getAttribute('color').array as Float32Array;
    const seen = new Set<string>();
    for (let i = 0; i < col.length; i += 3) seen.add(col[i].toFixed(3));
    expect(seen.size).toBeGreaterThan(4);
    expect(b.wood!.getAttribute('normal').count).toBe(b.wood!.getAttribute('position').count);
    expect(b.wood!.getAttribute('uv').count).toBe(b.wood!.getAttribute('position').count);
  });

  it('is the same for the same seed', () => {
    const a = raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 3).wood!.getAttribute('color').array;
    expect(raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 3).wood!.getAttribute('color').array).toEqual(a);
    expect(raisedBedGeometry(rect, 1.5, 1.25, '#8a6a47', frame, 4).wood!.getAttribute('color').array).not.toEqual(a);
  });

  it('gives nothing for a bed with no outline or no height', () => {
    expect(raisedBedGeometry([[0, 0], [1, 0]], 1.5, 1, '#888', frame).wood).toBeNull();
    expect(raisedBedGeometry(rect, 0, 0, '#888', frame).wood).toBeNull();
  });
});
