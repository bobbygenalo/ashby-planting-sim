import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bladePoints, leafWidthProfile, type BladeSpec } from '../engine/foliage';
import type { LookData } from '../engine/types';

/**
 * A unit leaf: base at the origin, tip at +X, widest width 1 along Y, the upper face toward +Z. Folded lengthwise
 * along the midrib and with a drooping tip, so it catches light on both halves. Scale it by (length, width, width).
 */
export function leafGeometry(shape: LookData['leaf']['shape'], fold = 0.3, curl = 0.18): THREE.BufferGeometry {
  const rows = shape === 'frond' ? 24 : 7;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const w = leafWidthProfile(shape, t) / 2;
    for (const c of [-1, 0, 1]) pos.push(t, c * w, fold * Math.abs(c) * w * 0.9 - curl * t * t);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 3;
    for (const c of [0, 1]) idx.push(a + c, a + c + 3, a + c + 1, a + c + 1, a + c + 3, a + c + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Many arching blades, or strap leaves, as one mesh with colors from a dark base to a light tip. */
export function bladesGeometry(blades: BladeSpec[], base: THREE.Color, tip: THREE.Color): THREE.BufferGeometry | null {
  if (!blades.length) return null;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  let v = 0;
  for (const b of blades) {
    const steps = b.shape === 'frond' ? 26 : 9;
    const pts = bladePoints(b, steps);
    const side: [number, number] = [-Math.sin(b.az), Math.cos(b.az)];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const hw = (b.width / 2) * leafWidthProfile(b.shape, t);
      const [x, y, z] = pts[i];
      const lift = hw * 0.35; // a shallow ridge along the middle
      pos.push(x - side[0] * hw, y - side[1] * hw, z, x, y, z + lift, x + side[0] * hw, y + side[1] * hw, z);
      c.copy(base).lerp(tip, t * (0.7 + 0.3 * b.shade)).offsetHSL(0, 0, (b.shade - 0.5) * 0.08);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < steps; i++) {
      const a = v + i * 3;
      for (const k of [0, 1]) idx.push(a + k, a + k + 3, a + k + 1, a + k + 1, a + k + 3, a + k + 4);
    }
    v += (steps + 1) * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A five-petal flower facing +Z, one unit across, with a colored center; petals and center carry their own vertex colors. */
export function petalGeometry(petal: THREE.Color, center: THREE.Color): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  for (let k = 0; k < 5; k++) {
    const g = leafGeometry('oval', 0.15, -0.2); // curls up, like a cup
    g.scale(0.5, 0.42, 0.42);
    g.rotateY(-0.35); // tip raised
    g.rotateZ((k * Math.PI * 2) / 5);
    parts.push(paint(g, petal));
  }
  const dot = new THREE.CircleGeometry(0.1, 8);
  dot.translate(0, 0, 0.03);
  parts.push(paint(dot, center));
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    n.deleteAttribute('normal');
    return n;
  });
  const merged = mergeGeometries(flat, false)!;
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** A small tubular flower: a flared tube along +X, one unit long, open at the far end. */
export function tubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.2, 0.07, 1, 6, 1, false); // top (mouth) wide, bottom narrow
  g.rotateZ(-Math.PI / 2); // Y -> X, the top end toward +X
  g.translate(0.5, 0, 0);
  return g;
}

/** A slender seed plume along +X, one unit long: a long cone fattest near its base. */
export function plumeGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.1, 1, 6, 1, false);
  g.rotateZ(-Math.PI / 2); // tip toward +X
  g.translate(0.5, 0, 0);
  return g;
}

const UPV = new THREE.Vector3(0, 0, 1);
const tmpX = new THREE.Vector3(), tmpY = new THREE.Vector3(), tmpZ = new THREE.Vector3();
const m4 = new THREE.Matrix4(), roll = new THREE.Matrix4(), scl = new THREE.Matrix4();

/** The matrix that puts a unit shape at `p`, its +X along `dir` (or its +Z along `dir` when `along` is 'z'), turned by `rollRad` about that line, at the given scale. */
export function aimMatrix(p: [number, number, number], dir: [number, number, number], rollRad: number, scale: [number, number, number], along: 'x' | 'z' = 'x', out = new THREE.Matrix4()): THREE.Matrix4 {
  const d = tmpX.set(dir[0], dir[1], dir[2]).normalize();
  if (along === 'x') {
    const side = tmpY.crossVectors(UPV, d);
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    side.normalize();
    const up = tmpZ.crossVectors(d, side);
    m4.makeBasis(d, side, up);
    roll.makeRotationX(rollRad);
  } else {
    const side = tmpY.crossVectors(UPV.clone().setX(0).setY(1).setZ(0), d); // any perpendicular
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const other = tmpZ.crossVectors(d, side).normalize();
    m4.makeBasis(side, other, d);
    roll.makeRotationZ(rollRad);
  }
  scl.makeScale(scale[0], scale[1], scale[2]);
  out.copy(m4).multiply(roll).multiply(scl);
  out.setPosition(p[0], p[1], p[2]);
  return out;
}
