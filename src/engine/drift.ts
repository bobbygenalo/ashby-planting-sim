/**
 * A camera circling a target while looking at it: its offset from the target (in three.js ground coordinates, x and z) turned
 * about the vertical. Site north is -z and east is +x, so a positive turn about +y goes counter-clockwise seen from above with
 * north at the top. Pure; the turn is `degPerSecond * dt`, so it takes the same time round whatever the frame rate.
 */
export function driftOffset(x: number, z: number, degPerSecond: number, dt: number): { x: number; z: number } {
  const a = (degPerSecond * dt * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** The camera's bearing around the target in site terms, in radians, counter-clockwise from east: it grows as the camera circles counter-clockwise. */
export const driftAngle = (x: number, z: number): number => Math.atan2(-z, x);
