import { describe, expect, it } from 'vitest';
import { isRectangle, polygonArea, rotatePoints } from '../src/engine/geometry';
import { makeAppStore } from '../src/store/store';

const sides = (p: [number, number][]) => p.map((q, i) => Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]));
const centroid = (p: [number, number][]) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const bed: [number, number][] = [[20, 90], [24, 90], [24, 102], [20, 102]];

describe('rotating rectangular elements', () => {
  it('recognizes a rectangle at any angle, and nothing else', () => {
    expect(isRectangle(bed)).toBe(true);
    expect(isRectangle(rotatePoints(bed, 37))).toBe(true);
    expect(isRectangle([[0, 0], [4, 0], [4, 3], [1, 3]])).toBe(false); // trapezoid
    expect(isRectangle([[0, 0], [4, 0], [4, 3]])).toBe(false);
    expect(isRectangle([[0, 0], [4, 0], [5, 3], [1, 3]])).toBe(false); // parallelogram
  });

  it('turns about the center, keeping the size and every side length', () => {
    for (const deg of [15, 90, -30, 180]) {
      const r = rotatePoints(bed, deg);
      expect(centroid(r)[0]).toBeCloseTo(centroid(bed)[0], 3);
      expect(centroid(r)[1]).toBeCloseTo(centroid(bed)[1], 3);
      expect(polygonArea(r)).toBeCloseTo(polygonArea(bed), 2);
      sides(r).forEach((v, i) => expect(v).toBeCloseTo(sides(bed)[i], 3));
    }
    // quarter turn counterclockwise: the 4 ft wide, 12 ft deep bed becomes 12 wide, 4 deep
    const q = rotatePoints(bed, 90);
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 3);
    // four quarter turns come back to the start
    let p = bed;
    for (let i = 0; i < 4; i++) p = rotatePoints(p, 90);
    p.forEach((v, i) => { expect(v[0]).toBeCloseTo(bed[i][0], 3); expect(v[1]).toBeCloseTo(bed[i][1], 3); });
  });

  const draw = (s: ReturnType<typeof makeAppStore>, type: 'raisedBed' | 'patio' | 'path', pts: [number, number][]) => {
    s.getState().startDrawing(type);
    for (const p of pts) s.getState().addDrawPoint(p);
    return s.getState().finishDrawing()!;
  };

  it('rotates a drawn raised bed by any angle in the store, and undo brings it back', () => {
    const s = makeAppStore('edit');
    const id = draw(s, 'raisedBed', bed);
    s.getState().rotateElement(id, 15);
    const el = s.getState().hardscape.find((e) => e.id === id)!;
    expect(isRectangle(el.points)).toBe(true);
    expect(polygonArea(el.points)).toBeCloseTo(48, 2);
    expect(el.points).not.toEqual(bed);
    s.getState().rotateElement(id, -15);
    s.getState().hardscape.find((e) => e.id === id)!.points.forEach((v, i) => { expect(v[0]).toBeCloseTo(bed[i][0], 3); expect(v[1]).toBeCloseTo(bed[i][1], 3); });
    s.getState().undo();
    expect(isRectangle(s.getState().hardscape.find((e) => e.id === id)!.points)).toBe(true);
  });

  it('leaves alone anything that is not a rectangle, a path, existing work, and view mode', () => {
    const s = makeAppStore('edit');
    const l = draw(s, 'patio', [[20, 90], [30, 90], [30, 96], [24, 102], [20, 102]]);
    const before = JSON.stringify(s.getState().hardscape.find((e) => e.id === l)!.points);
    s.getState().rotateElement(l, 90);
    expect(JSON.stringify(s.getState().hardscape.find((e) => e.id === l)!.points)).toBe(before);
    const path = draw(s, 'path', [[5, 90], [15, 95]]);
    const pb = JSON.stringify(s.getState().hardscape.find((e) => e.id === path)!.points);
    s.getState().rotateElement(path, 90);
    expect(JSON.stringify(s.getState().hardscape.find((e) => e.id === path)!.points)).toBe(pb);
    const driveway = s.getState().hardscape.find((e) => e.existing)!;
    const db = JSON.stringify(driveway.points);
    s.getState().rotateElement(driveway.id, 90);
    expect(JSON.stringify(s.getState().hardscape.find((e) => e.id === driveway.id)!.points)).toBe(db);
    const v = makeAppStore('view');
    const any = v.getState().hardscape[0];
    const vb = JSON.stringify(any.points);
    v.getState().rotateElement(any.id, 90);
    expect(JSON.stringify(v.getState().hardscape[0].points)).toBe(vb);
  });
});
