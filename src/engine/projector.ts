import { distanceToPolygon, pointInPolygon } from './geometry';
import type { Pt } from './types';

/** A ball in site coordinates (feet): a rough piece of a body, for working out its shadow. */
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** A shadow on the wall: a disc in the wall's own coordinates (y along the wall, z up). */
export interface Disc {
  y: number;
  z: number;
  r: number;
}

/**
 * A person as a handful of balls: head, shoulders and chest, hips, thighs and shins (a leg each side), and with `armsUp`
 * (shadow puppets) a raised arm on each side. Sizes follow the person's height; `heading` is the way they face.
 */
export function personSpheres(x: number, y: number, heading: number, heightFt: number, armsUp = false): Sphere[] {
  const h = heightFt, c = Math.cos(heading), s = Math.sin(heading);
  // along the way they face (a) and to their left (l)
  const at = (a: number, l: number, z: number, r: number): Sphere => ({ x: x + c * a * h - s * l * h, y: y + s * a * h + c * l * h, z: z * h, r: r * h });
  const out: Sphere[] = [
    at(0, 0, 0.93, 0.085), // head
    at(0, 0, 0.8, 0.1), at(0, 0.09, 0.8, 0.075), at(0, -0.09, 0.8, 0.075), // shoulders
    at(0, 0, 0.68, 0.115), at(0, 0, 0.56, 0.115), // chest and waist
    at(0, 0.06, 0.48, 0.09), at(0, -0.06, 0.48, 0.09), // hips
    at(0, 0.06, 0.34, 0.07), at(0, -0.06, 0.34, 0.07), // thighs
    at(0, 0.06, 0.16, 0.06), at(0, -0.06, 0.16, 0.06), // shins
  ];
  if (armsUp) out.push(at(0, 0.2, 0.95, 0.05), at(0, -0.2, 0.95, 0.05), at(0, 0.24, 1.12, 0.045), at(0, -0.24, 1.12, 0.045));
  else out.push(at(0, 0.17, 0.68, 0.045), at(0, -0.17, 0.68, 0.045)); // arms hanging
  return out;
}

/** A dog (shoulder height `heightFt`) as three balls: chest, rump and head. */
export function dogSpheres(x: number, y: number, heading: number, heightFt: number): Sphere[] {
  const h = heightFt, c = Math.cos(heading), s = Math.sin(heading);
  const at = (a: number, z: number, r: number): Sphere => ({ x: x + c * a * h, y: y + s * a * h, z: z * h, r: r * h });
  return [at(0.45, 0.62, 0.3), at(-0.45, 0.62, 0.28), at(0.95, 0.85, 0.17)];
}

/**
 * The shadows a light at `lens` throws onto the vertical wall x = `wallX` (the light is on the east side, the wall faces east):
 * each ball between the light and the wall casts a disc, magnified by how much farther the wall is than the ball. Balls behind the
 * light or beyond the wall cast none.
 */
export function castOnWall(spheres: Sphere[], lens: [number, number, number], wallX: number): Disc[] {
  const out: Disc[] = [];
  const dWall = lens[0] - wallX;
  for (const b of spheres) {
    const dBall = lens[0] - b.x;
    // between the lens and the wall, with the whole ball on this side of the wall and nowhere near the lens itself
    if (dBall <= b.r + 0.2 || b.x - b.r <= wallX) continue;
    const k = dWall / dBall;
    out.push({ y: lens[1] + (b.y - lens[1]) * k, z: lens[2] + (b.z - lens[2]) * k, r: b.r * k });
  }
  return out;
}

export interface WallRect {
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** The share of the screen that the discs cover, by sampling a grid across it (0 to 1). */
export function coverage(discs: Disc[], rect: WallRect, cols = 28, rows = 16): number {
  const near = discs.filter((d) => d.y + d.r > rect.y0 && d.y - d.r < rect.y1 && d.z + d.r > rect.z0 && d.z - d.r < rect.z1);
  if (!near.length) return 0;
  let hit = 0;
  for (let j = 0; j < rows; j++) {
    const z = rect.z0 + ((j + 0.5) / rows) * (rect.z1 - rect.z0);
    for (let i = 0; i < cols; i++) {
      const y = rect.y0 + ((i + 0.5) / cols) * (rect.y1 - rect.y0);
      if (near.some((d) => (d.y - y) ** 2 + (d.z - z) ** 2 <= d.r * d.r)) hit++;
    }
  }
  return hit / (cols * rows);
}

/** The beam as it falls on the ground, in plan: a triangle from the lens to the two ends of the screen at the wall. */
export function beamTriangle(lens: [number, number, number], wallX: number, y0: number, y1: number): Pt[] {
  return [[lens[0], lens[1]], [wallX, y0], [wallX, y1]];
}

/** Whether a standing person at (x, y) would be in the light: inside the beam's footprint or within `marginFt` of it. */
export function inBeam(x: number, y: number, tri: Pt[], marginFt: number): boolean {
  return pointInPolygon(x, y, tri) || distanceToPolygon(x, y, tri) <= marginFt;
}
