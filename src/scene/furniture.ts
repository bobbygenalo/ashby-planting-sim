import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHAIR, tableLayout } from '../engine/furniture';

/** A piece of a model: merged geometry in the model's own frame (centered, Z up, long side along X) and its color; null takes the element's color. */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  color: string | null;
}

export { rectFrame } from '../engine/furniture';

const box = (w: number, d: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, d, h);
  g.translate(x, y, z + h / 2);
  return g;
};
const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(list, false)!;
  list.forEach((x) => x.dispose());
  return g;
};

/** The table top and its legs, in the table's own frame (long side along X). The chairs are separate, so people can pull them out. */
export function tableModel(L: number, W: number): ModelPart[] {
  const { tableL: tl, tableW: tw } = tableLayout(L, W);
  const table: THREE.BufferGeometry[] = [box(tl, tw, 0.2, 0, 0, 2.3)];
  const lx = tl / 2 - 0.3, ly = tw / 2 - 0.3;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) table.push(box(0.25, 0.25, 2.3, sx * lx, sy * ly, 0));
  return [{ geometry: merge(table), color: null }];
}

/** One chair centered on the origin, facing +X (toward the table), its back on the far side. */
export function chairGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [box(CHAIR, CHAIR, 0.15, 0, 0, 1.45)];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) parts.push(box(0.12, 0.12, 1.45, dx * (CHAIR / 2 - 0.1), dy * (CHAIR / 2 - 0.1), 0));
  parts.push(box(0.14, CHAIR, 1.2, -(CHAIR / 2 - 0.07), 0, 1.6));
  return merge(parts);
}

/**
 * A barbecue grill on its cart in the middle of an `L` by `D` footprint, with a counter on each side of it, 3 ft high.
 * The grill is about 2.5 ft wide; whatever the footprint has beyond that is counter.
 */
export function grillModel(L: number, D: number): ModelPart[] {
  const gw = Math.min(2.5, Math.max(1.5, L * 0.4));
  const cw = Math.max(0.5, (L - gw) / 2);
  const counters: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    counters.push(box(cw, D, 2.85, s * (gw / 2 + cw / 2), 0, 0));
    counters.push(box(cw + 0.1, D + 0.1, 0.15, s * (gw / 2 + cw / 2), 0, 2.85));
  }
  const body = [box(gw, D - 0.3, 2.2, 0, 0, 0)];
  const hood = [box(gw, D - 0.45, 0.6, 0, 0.05, 2.2), box(gw * 0.7, 0.12, 0.12, 0, -(D - 0.45) / 2 - 0.08, 2.6), box(0.2, 0.2, 0.25, gw * 0.25, (D - 0.45) / 2 - 0.2, 2.8)];
  return [
    { geometry: merge(counters), color: null },
    { geometry: merge(body), color: '#2a2a2d' },
    { geometry: merge(hood), color: '#44444a' },
  ];
}

export const modelFor = (model: 'table' | 'grill', long: number, short: number): ModelPart[] => (model === 'table' ? tableModel(long, short) : grillModel(long, short));
