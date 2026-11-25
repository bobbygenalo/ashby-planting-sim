import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { grab, groundUnder, letGo, takeHold } from '../src/scene/grab';

// Site (x, y, z) is three.js (x, z, -y): the ground is the plane y = 0 and a point of the lot at site (x, y) is world (x, 0, -y).
const rayThrough = (from: [number, number, number], to: [number, number, number]) =>
  new THREE.Ray(new THREE.Vector3(...from), new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize());

describe('holding a plant where it was grabbed', () => {
  it('finds the ground under a ray in site coordinates, and nothing for a ray that never reaches it', () => {
    const g = groundUnder(rayThrough([10, 20, 5], [10, 0, -30]))!;
    expect(g[0]).toBeCloseTo(10);
    expect(g[1]).toBeCloseTo(30);
    expect(groundUnder(rayThrough([0, 5, 0], [0, 10, -5]))).toBeNull(); // pointing up
  });

  it('keeps the plant under the cursor when it is grabbed by its crown, high above the ground', () => {
    // A camera south-east of the plant, looking down at it: the press hits the crown 12 ft up, but the ground under that
    // pixel is well behind the plant, so following the ground alone would make it jump.
    const plantAt: [number, number] = [40, 60];
    const camera: [number, number, number] = [60, 50, 20]; // world: x 60, up 50, z 20 (site y -20)
    const crown: [number, number, number] = [plantAt[0], 12, -plantAt[1]];
    const ray = rayThrough(camera, crown);
    const ground = groundUnder(ray)!;
    expect(Math.hypot(ground[0] - plantAt[0], ground[1] - plantAt[1])).toBeGreaterThan(3); // the jump this fixes
    takeHold(ray, plantAt);
    // not moving the cursor leaves it where it is
    expect(ground[0] + grab.dx).toBeCloseTo(plantAt[0]);
    expect(ground[1] + grab.dy).toBeCloseTo(plantAt[1]);
    // moving the cursor along the ground moves the plant by the same amount
    const moved = groundUnder(rayThrough(camera, [crown[0] + 7, 0, crown[2] - 4]))!;
    expect(moved[0] + grab.dx - plantAt[0]).toBeCloseTo(moved[0] - ground[0]);
    expect(moved[1] + grab.dy - plantAt[1]).toBeCloseTo(moved[1] - ground[1]);
    letGo();
    expect(grab.dx).toBe(0);
    expect(grab.dy).toBe(0);
  });

  it('is no offset at all when looking straight down at a flat thing', () => {
    takeHold(rayThrough([20, 100, -30], [20, 0, -30]), [20, 30]);
    expect(grab.dx).toBeCloseTo(0);
    expect(grab.dy).toBeCloseTo(0);
    letGo();
  });
});
