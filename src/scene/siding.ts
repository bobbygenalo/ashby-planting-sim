import * as THREE from 'three';

/**
 * Split a geometry's triangles into those whose face normal passes `pick` and the rest. The picked ones get UVs measured in
 * feet (u along the wall, v up) so a tiled surface texture can wrap them; both come back as plain (non-indexed) geometries.
 * The geometry is in site coordinates (x across, y toward the rear, z up).
 */
export function splitFaces(geo: THREE.BufferGeometry, pick: (n: THREE.Vector3) => boolean): { picked: THREE.BufferGeometry | null; rest: THREE.BufferGeometry } {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const pp: number[] = [], pu: number[] = [], rp: number[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    if (pick(n)) {
      for (const p of [a, b, c]) {
        pp.push(p.x, p.y, p.z);
        pu.push(Math.abs(n.x) > Math.abs(n.y) ? p.y : p.x, -p.z);
      }
    } else for (const p of [a, b, c]) rp.push(p.x, p.y, p.z);
  }
  const build = (positions: number[], uvs?: number[]) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uvs) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    out.computeVertexNormals();
    return out;
  };
  return { picked: pp.length ? build(pp, pu) : null, rest: build(rp) };
}
