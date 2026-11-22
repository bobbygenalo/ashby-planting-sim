import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Skeleton } from '../engine/branches';

const UP = new THREE.Vector3(0, 0, 1);

/** One merged mesh for all the branches: a tapered cylinder per segment, Z up like the plant's other parts. */
export function branchGeometry(sk: Skeleton): THREE.BufferGeometry | null {
  const pieces = sk.segments.map((s) => {
    const a = new THREE.Vector3(...s.a);
    const b = new THREE.Vector3(...s.b);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(s.r1, s.r0, len, 5, 1, true); // top, bottom; height along Y
    g.rotateX(Math.PI / 2); // Y -> Z
    g.translate(0, 0, len / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    return g;
  });
  if (pieces.length === 0) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}
