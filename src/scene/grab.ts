import * as THREE from 'three';

const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

/**
 * Where a pointer ray meets the ground, in site coordinates (x across, y toward the rear), or null when it never does. A press lands
 * on a plant's crown, a bed's side or a hive's column, well above the ground; dragging follows the ground under the cursor, so the
 * two must be compared on the same plane.
 */
export function groundUnder(ray: THREE.Ray): [number, number] | null {
  return ray.intersectPlane(ground, hit) ? [hit.x, -hit.z] : null;
}

/** How far the grabbed thing's position is from the ground under the cursor at the moment of the press, so it moves with the cursor instead of jumping to it. */
export const grab = { dx: 0, dy: 0 };

/** Remember the offset from the ground under the cursor to a thing at `at` (zero when the ray misses the ground). */
export function takeHold(ray: THREE.Ray, at: [number, number]): void {
  const g = groundUnder(ray);
  grab.dx = g ? at[0] - g[0] : 0;
  grab.dy = g ? at[1] - g[1] : 0;
}

export const letGo = (): void => { grab.dx = 0; grab.dy = 0; };
