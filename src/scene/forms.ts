import * as THREE from 'three';
import { canopyRadius } from '../engine/canopy';
import type { Habit } from '../engine/types';

/**
 * How to stand a three.js hemisphere (a sphere cut along its Y axis) up as a dome in site coordinates, where Z is up.
 * The geometry's pole points along its own +Y, so it is turned a quarter turn about X to point up. Scale is applied
 * before rotation, so the pole axis takes the height and the other two take the radius.
 */
export function domeTransform(radius: number, height: number): { rotation: [number, number, number]; scale: [number, number, number] } {
  return { rotation: [Math.PI / 2, 0, 0], scale: [radius, height, radius] };
}

/** Where a point of the unit hemisphere lands after `domeTransform` (scale, then a rotation about X). For tests. */
export function applyDome(p: [number, number, number], radius: number, height: number): [number, number, number] {
  const { rotation, scale } = domeTransform(radius, height);
  const [x, y, z] = [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]];
  const c = Math.cos(rotation[0]), s = Math.sin(rotation[0]);
  return [x, y * c - z * s, y * s + z * c];
}

// ---------------------------------------------------------------------------------------------
// Plant forms as data, so every shape can be measured against the plant's size
// ---------------------------------------------------------------------------------------------


type Vec3 = [number, number, number];

/** What one piece of a plant is built from. Positions and rotations are in site coordinates (Z up), from the trunk. */
export interface Part {
  shape: 'ellipsoid' | 'dome' | 'cylinder' | 'cone' | 'box' | 'lathe';
  material: 'foliage' | 'trunk';
  position: Vec3;
  /** Euler angles (XYZ). */
  rotation: Vec3;
  scale: Vec3;
  /** Shape arguments: cylinder [radiusTop, radiusBottom, height], cone [radius, height], box [x, y, z], lathe [radius, height, radius, height, ...]. */
  args: number[];
}

/** The smallest height or radius a form is drawn at, so a new groundcover is still there to see. */
export const MIN_FORM_SIZE = 0.12;

const UP: Vec3 = [Math.PI / 2, 0, 0];
const ONE: Vec3 = [1, 1, 1];

/** An upright cylinder (three.js cylinders point along Y, so they are turned to point up). */
const column = (rTop: number, rBottom: number, height: number, z: number, material: Part['material'] = 'foliage'): Part => ({
  shape: 'cylinder', material, position: [0, 0, z + height / 2], rotation: UP, scale: ONE, args: [rTop, rBottom, height],
});

/** A smooth outline revolved around the trunk, sampled from the shared canopy profile. */
const revolved = (habit: Habit, radius: number, canopyH: number, z: number, grounded = false): Part => {
  // More samples toward the top, where the rounded cap curves in fastest.
  const steps = 40;
  const args: number[] = [0, 0];
  for (let i = 0; i <= steps; i++) {
    const zf = 1 - (1 - i / steps) ** 1.5;
    args.push(canopyRadius(habit, radius, zf, grounded), zf * canopyH);
  }
  return { shape: 'lathe', material: 'foliage', position: [0, 0, z], rotation: UP, scale: ONE, args };
};

const dome = (radius: number, height: number, z: number): Part => {
  const t = domeTransform(radius, height);
  return { shape: 'dome', material: 'foliage', position: [0, 0, z], rotation: t.rotation, scale: t.scale, args: [] };
};

/**
 * The shape of a plant for its habit, `r` the canopy radius and `h` the height, both in feet, and `trunkFrac` the
 * share of the height that is bare trunk. The top of the shape is at `h` and nothing goes below the ground or past `r`.
 */
export function plantParts(habit: Habit, r: number, h: number, trunkFrac: number, seed = 1): Part[] {
  const height = Math.max(h, MIN_FORM_SIZE);
  const radius = Math.max(r, MIN_FORM_SIZE / 2);
  const base = height * trunkFrac;
  const canopyH = height - base;
  const parts: Part[] = [];
  if (base > 0.02 && habit !== 'clump' && habit !== 'mat' && habit !== 'vine') {
    parts.push(column(Math.min(0.35, radius * 0.1) * 0.7 + 0.02, Math.min(0.5, radius * 0.14) * 0.7 + 0.03, base, 0, 'trunk'));
  }
  switch (habit) {
    case 'columnar':
    case 'vase':
      parts.push(revolved(habit, radius, canopyH, base));
      break;
    case 'spreading':
    case 'weeping':
      parts.push(dome(radius, canopyH, base));
      break;
    case 'clump': {
      // Blades fan out from the middle, each leaning so its tip lands inside the canopy radius.
      const rng = mulberry(seed);
      const blades = 14;
      const bladeR = Math.max(radius * 0.1, 0.01);
      for (let i = 0; i < blades; i++) {
        const a = i * 2.399963229728653 + rng() * 0.4;
        const tipR = Math.max(0, radius - bladeR) * (0.45 + 0.55 * ((i + 0.5) / blades));
        const baseR = Math.min(tipR, radius * 0.18);
        const bx = Math.cos(a) * baseR, by = Math.sin(a) * baseR;
        const lat = tipR - baseR;
        const lx = Math.cos(a) * lat, ly = Math.sin(a) * lat;
        // A leaning cone's base disc tilts with it, so its low edge is lifted to sit on the ground, and the blade is
        // shortened so its tip still lands at the plant height.
        let len = Math.hypot(lat, height);
        let lift = 0;
        for (let k = 0; k < 4; k++) {
          const sinTilt = len > 0 ? lat / len : 0;
          lift = bladeR * sinTilt;
          len = Math.hypot(lat, Math.max(height - lift, 0.01));
        }
        const dir = new THREE.Vector3(lx, ly, Math.max(height - lift, 0.01)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const e = new THREE.Euler().setFromQuaternion(q);
        parts.push({
          shape: 'cone', material: 'foliage', rotation: [e.x, e.y, e.z], scale: ONE, args: [bladeR, len],
          position: [bx + (dir.x * len) / 2, by + (dir.y * len) / 2, lift + (dir.z * len) / 2],
        });
      }
      break;
    }
    case 'mat':
      // A low rounded mound hugging the ground, not a puck with a flat top and straight sides.
      parts.push(dome(radius, height, 0));
      break;
    case 'vine':
      // A vine is a tall, shallow mass: wide in one direction, thin in the other, rounded all over.
      parts.push({ shape: 'ellipsoid', material: 'foliage', position: [0, 0, height / 2], rotation: [0, 0, 0], scale: [radius, Math.min(radius, Math.max(0.4, radius * 0.45)), height / 2], args: [] });
      break;
    default:
      // A trunkless round plant sits on the ground with a broad base; one on a trunk is a full ellipsoid canopy.
      if (base <= 0.02) {
        parts.push(revolved('round', radius, canopyH, base, true));
        break;
      }
      parts.push({ shape: 'ellipsoid', material: 'foliage', position: [0, 0, base + canopyH / 2], rotation: [0, 0, 0], scale: [radius, radius, canopyH / 2], args: [] });
  }
  return parts;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three.js geometry for a part, before its position, rotation and scale are applied. */
export function partGeometry(p: Part): THREE.BufferGeometry {
  switch (p.shape) {
    case 'ellipsoid':
      return new THREE.SphereGeometry(1, 20, 14);
    case 'dome':
      return new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'cylinder':
      return new THREE.CylinderGeometry(p.args[0], p.args[1], p.args[2], p.material === 'trunk' ? 8 : 20);
    case 'cone':
      return new THREE.ConeGeometry(p.args[0], p.args[1], 6);
    case 'box':
      return new THREE.BoxGeometry(p.args[0], p.args[1], p.args[2]);
    case 'lathe': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < p.args.length; i += 2) pts.push(new THREE.Vector2(p.args[i], p.args[i + 1]));
      return new THREE.LatheGeometry(pts, 24);
    }
  }
}

/** The extent of a part in the plant's frame, from its real vertices. */
export function partBounds(p: Part): { min: Vec3; max: Vec3 } {
  const g = partGeometry(p);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation)), new THREE.Vector3(...p.scale),
  );
  g.applyMatrix4(m);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.dispose();
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}
