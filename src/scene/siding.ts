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

/**
 * Slide the vertical faces of a roof (a gable end, which the roof's overhang pushes out past the wall) back onto the wall below:
 * each moves along its own normal to the nearest wall of `footprint` that faces the same way, so the triangle under a gable is one
 * surface with the wall under it and only the roof's edge arches over it. A face with no such wall within `maxFt` is left as it is. Sloping roof
 * surfaces meet it exactly, because a gable's roof height does not change along the ridge.
 */
export function flushToWalls(geo: THREE.BufferGeometry, footprint: [number, number][], maxFt: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let area = 0;
  for (let i = 0; i < footprint.length; i++) {
    const [x1, y1] = footprint[i], [x2, y2] = footprint[(i + 1) % footprint.length];
    area += x1 * y2 - x2 * y1;
  }
  const sign = area >= 0 ? 1 : -1; // counter-clockwise: the outward normal of an edge is (dy, -dx)
  const edges = footprint.map(([x1, y1], i) => {
    const [x2, y2] = footprint[(i + 1) % footprint.length];
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
    return { q: [x1, y1] as [number, number], n: [(dy / l) * sign, (-dx / l) * sign] as [number, number] };
  });
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    let best = Infinity;
    for (const e of edges) {
      if (e.n[0] * n.x + e.n[1] * n.y < 0.99) continue;
      const d = (a.x - e.q[0]) * n.x + (a.y - e.q[1]) * n.y;
      if (d >= -1e-4 && d <= maxFt && d < best) best = d;
    }
    if (!Number.isFinite(best) || best < 1e-6) continue;
    for (const k of [i, i + 1, i + 2]) pos.setXYZ(k, pos.getX(k) - n.x * best, pos.getY(k) - n.y * best, pos.getZ(k));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
