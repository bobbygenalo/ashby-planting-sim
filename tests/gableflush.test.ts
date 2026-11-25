import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { flushToWalls, splitFaces } from '../src/scene/siding';

// a gable roof over a 10 x 20 ft footprint (ridge along y), 1 ft overhang all round, eave at 8 ft, ridge at 13 ft
const footprint: [number, number][] = [[0, 0], [10, 0], [10, 20], [0, 20]];
const hull = new ConvexGeometry([[-1, -1, 8], [11, -1, 8], [11, 21, 8], [-1, 21, 8], [5, -1, 13.5], [5, 21, 13.5]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));

describe('a gable end sits on the wall below it', () => {
  it('moves the roof overhang\'s end triangles back onto the front and back wall planes', () => {
    const vertical = splitFaces(hull, (n) => Math.abs(n.z) < 0.1).picked!;
    const flush = flushToWalls(vertical, footprint, 4);
    const ys = new Set<number>();
    const pos = flush.getAttribute('position');
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1000) / 1000);
    expect([...ys].sort((a, b) => a - b)).toEqual([0, 20]);
    // heights and widths along the wall are unchanged
    let maxZ = 0, minX = 99, maxX = -99;
    for (let i = 0; i < pos.count; i++) { maxZ = Math.max(maxZ, pos.getZ(i)); minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i)); }
    expect(maxZ).toBeCloseTo(13.5, 6);
    expect([minX, maxX]).toEqual([-1, 11]);
  });

  it('leaves a face with no wall behind it alone', () => {
    const vertical = splitFaces(hull, (n) => Math.abs(n.z) < 0.1).picked!;
    const none = flushToWalls(vertical, [[100, 100], [110, 100], [110, 120], [100, 120]], 4);
    const a = vertical.toNonIndexed().getAttribute('position'), b = none.getAttribute('position');
    for (let i = 0; i < a.count; i++) expect(b.getY(i)).toBeCloseTo(a.getY(i), 9);
  });
});
