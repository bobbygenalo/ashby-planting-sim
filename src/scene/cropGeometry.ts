import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CropPlant, ProduceSpec } from '../engine/cropPlants';
import type { Foliage } from '../engine/foliage';
import type { Crop, LookData } from '../engine/types';
import { branchGeometry } from './branchGeometry';
import { aimMatrix, bladesGeometry, leafGeometry } from './foliageGeometry';

/** Make a piece ready to merge: flat (no index), position, normal and color only. */
function prep(g: THREE.BufferGeometry, color?: (i: number) => THREE.Color): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  if (color || !n.getAttribute('color')) {
    const count = n.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const c = color ? color(i) : new THREE.Color('#ffffff');
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return n;
}

const merge = (pieces: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
  if (!pieces.length) return null;
  const g = mergeGeometries(pieces, false);
  pieces.forEach((p) => p.dispose());
  return g;
};

/** One crop plant's leaves, blades and stems as a single colored mesh. */
export function cropFoliageGeometry(look: LookData, fol: Foliage, leafColor: string): THREE.BufferGeometry | null {
  const base = new THREE.Color(leafColor);
  const back = new THREE.Color(look.leaf.underColor ?? leafColor);
  const pieces: THREE.BufferGeometry[] = [];
  if (fol.leaves.length) {
    const shapeGeo = leafGeometry(look.leaf.shape, look.leaf.fold ?? 0.3, (look.leaf.droop ?? 0.25) * 0.7);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const l of fol.leaves) {
      const g = shapeGeo.clone();
      g.applyMatrix4(aimMatrix(l.p, l.dir, l.roll, [l.length, l.width, l.width], 'x', m));
      c.copy(l.under ? back : base).offsetHSL(0, 0, (l.shade - 0.5) * 0.1);
      const col = c.clone();
      pieces.push(prep(g, () => col));
    }
    shapeGeo.dispose();
  }
  if (fol.blades.length) {
    const b = bladesGeometry(fol.blades, base.clone().multiplyScalar(0.7), base.clone().lerp(new THREE.Color('#ffffff'), 0.1));
    if (b) pieces.push(prep(b));
  }
  if (fol.skeleton && fol.skeleton.segments.length) {
    const w = branchGeometry(fol.skeleton);
    const stem = new THREE.Color(look.trunkColor ?? leafColor);
    if (w) pieces.push(prep(w, () => stem));
  }
  return merge(pieces);
}

/** A unit piece of produce: attached at the origin, reaching along +Z for about one unit. */
function oneProduce(shape: NonNullable<Crop['produce']>['shape']): { geo: THREE.BufferGeometry; cap?: THREE.BufferGeometry } {
  const along = (g: THREE.BufferGeometry, len: number) => { g.rotateX(Math.PI / 2); g.translate(0, 0, len / 2); return g; };
  switch (shape) {
    case 'pepper':
      return { geo: along(new THREE.CylinderGeometry(0.03, 0.4, 1.7, 8), 1.7), cap: new THREE.ConeGeometry(0.22, 0.14, 6).rotateX(-Math.PI / 2).translate(0, 0, 0.02) };
    case 'eggplant': {
      const g = new THREE.SphereGeometry(0.5, 12, 9);
      g.scale(0.85, 0.85, 1.9);
      g.translate(0, 0, 0.95);
      return { geo: g, cap: new THREE.ConeGeometry(0.32, 0.22, 7).rotateX(-Math.PI / 2).translate(0, 0, 0.05) };
    }
    case 'zucchini': return { geo: along(new THREE.CylinderGeometry(0.4, 0.46, 2.3, 10), 2.3) };
    case 'cucumber': return { geo: along(new THREE.CylinderGeometry(0.27, 0.31, 2.1, 8), 2.1) };
    case 'pod': {
      const g = along(new THREE.CylinderGeometry(0.12, 0.08, 2.4, 5), 2.4);
      g.scale(1, 0.6, 1);
      return { geo: g };
    }
    case 'carrot': {
      const g = new THREE.SphereGeometry(0.5, 8, 6);
      g.scale(1, 1, 0.45);
      g.translate(0, 0, 0.12);
      return { geo: g };
    }
    case 'berry': {
      // Wide at the stalk and pointing at the tip, like a strawberry.
      const pts = [[0.0, 0], [0.3, 0.04], [0.46, 0.28], [0.4, 0.62], [0.2, 0.9], [0.0, 1]].map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(pts, 9);
      g.rotateX(Math.PI / 2);
      return { geo: g, cap: new THREE.ConeGeometry(0.3, 0.12, 6).rotateX(-Math.PI / 2).translate(0, 0, 0.0) };
    }
    case 'head': {
      // A broccoli head: a bumpy dome of small florets.
      const parts: THREE.BufferGeometry[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < 22; k++) {
        const z = 1 - (k + 0.5) / 22;
        const rr = Math.sqrt(Math.max(0, 1 - z * z));
        const s = new THREE.SphereGeometry(0.2, 6, 5);
        s.translate(Math.cos(k * golden) * rr * 0.34, Math.sin(k * golden) * rr * 0.34, 0.1 + z * 0.3);
        parts.push(prep(s));
      }
      const core = new THREE.SphereGeometry(0.34, 8, 6);
      core.scale(1, 1, 0.7);
      core.translate(0, 0, 0.12);
      parts.push(prep(core));
      return { geo: mergeGeometries(parts, false)! };
    }
    default: {
      const g = new THREE.SphereGeometry(0.5, 10, 8);
      g.scale(1, 1, 0.9);
      g.translate(0, 0, 0.45);
      return { geo: g };
    }
  }
}

/** All of one plant's produce as a single colored mesh (the stalk end of a pepper or eggplant gets a green cap). */
export function produceGeometry(crop: Crop, list: ProduceSpec[]): THREE.BufferGeometry | null {
  const pr = crop.produce;
  if (!pr || !list.length) return null;
  const { geo, cap } = oneProduce(pr.shape);
  const base = new THREE.Color(pr.color);
  const green = new THREE.Color('#4f7a38');
  const pieces: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (const p of list) {
    const c = base.clone().offsetHSL(0, 0, (p.shade - 0.5) * 0.12);
    const g = geo.clone();
    g.applyMatrix4(aimMatrix(p.p, p.dir, p.roll, [p.size, p.size, p.size], 'z', m));
    pieces.push(prep(g, () => c));
    if (cap) {
      const k = cap.clone();
      k.applyMatrix4(m);
      pieces.push(prep(k, () => green));
    }
  }
  geo.dispose();
  cap?.dispose();
  return merge(pieces);
}

/** Both meshes of a built crop plant. */
export function cropMeshes(crop: Crop, plant: CropPlant): { foliage: THREE.BufferGeometry | null; produce: THREE.BufferGeometry | null } {
  return { foliage: cropFoliageGeometry(crop.look, plant.foliage, crop.leafColor), produce: produceGeometry(crop, plant.produce) };
}
