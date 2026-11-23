import * as THREE from 'three';
import { barkRidge, trunkCenter, trunkRadiusAt } from '../engine/trunk';
import type { TrunkCfg } from '../engine/types';

/**
 * A trunk from the ground to `trunkH`: wider at the foot (the root flare) and tapering to the top, with ridged bark and a
 * gentle sideways wander that is zero at the top, where the limbs begin. UVs run in feet (about a tile per 2.5 ft along it and
 * one around per foot of girth), so a texture on it keeps its scale as the tree grows.
 */
export function trunkGeometry(trunkH: number, totalH: number, seed: number, cfg: TrunkCfg): THREE.BufferGeometry {
  const sides = cfg.sides, rings = cfg.rings;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const girth = Math.max(1, Math.round((2 * Math.PI * trunkRadiusAt(trunkH * 0.5, trunkH, totalH, cfg)) / 1.1));
  for (let i = 0; i <= rings; i++) {
    // More rings near the ground, where the flare changes fastest.
    const z = trunkH * (i / rings) ** 1.35;
    const [cx, cy] = trunkCenter(z, trunkH, seed, cfg);
    const r = trunkRadiusAt(z, trunkH, totalH, cfg);
    for (let j = 0; j <= sides; j++) {
      const az = (j / sides) * Math.PI * 2;
      const rr = r * barkRidge(az, z, seed, cfg);
      pos.push(cx + Math.cos(az) * rr, cy + Math.sin(az) * rr, z);
      uv.push((j / sides) * girth, z / 2.5);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
