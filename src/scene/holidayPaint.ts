import * as THREE from 'three';
import type { Bulb } from '../engine/holiday';

/**
 * Put every bulb in place and give it its color, on the bulbs and on the glow around them: bright when lit, dull when
 * not. Run whenever the meshes are (re)created or the lights go on or off, so a bulb is never left uncolored.
 */
export function paintBulbs(bulbs: THREE.InstancedMesh, glow: THREE.InstancedMesh, list: Bulb[], colors: string[], lit: boolean, offDim: number): void {
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  list.forEach((b, i) => {
    d.position.set(b.pos[0], b.pos[1], b.pos[2]);
    d.scale.setScalar(1);
    d.updateMatrix();
    bulbs.setMatrixAt(i, d.matrix);
    glow.setMatrixAt(i, d.matrix);
    c.set(colors[b.color]);
    if (!lit) c.multiplyScalar(offDim);
    bulbs.setColorAt(i, c);
    c.set(colors[b.color]);
    glow.setColorAt(i, c);
  });
  bulbs.count = glow.count = list.length;
  bulbs.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  glow.visible = lit;
}
