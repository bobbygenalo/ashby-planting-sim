import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { activeStructures, loadSite } from '../src/engine/site';
import { pointInPolygon } from '../src/engine/geometry';
import type { Pt } from '../src/engine/types';

const site = loadSite(siteRaw);
const structures = activeStructures(site, { aduEnabled: true });

/** Distance from a point to a segment. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The walls (edges of a footprint) that face a direction and pass within `tol` of a point. */
function wallsAt(p: Pt, facing: Pt, tol: number) {
  const out: { id: string; top: number; open: boolean }[] = [];
  for (const st of structures) {
    const fp = st.footprint;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6 || segDist(p, a, b) > tol) continue;
      // outward normal of the edge: the side that is outside the footprint
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let n: Pt = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      if (pointInPolygon(mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05, fp)) n = [-n[0], -n[1]];
      if (n[0] * facing[0] + n[1] * facing[1] > 0.99) out.push({ id: st.id, top: Math.max(st.eaveHeight, st.ridgeHeight), open: !!st.open });
    }
  }
  return out;
}

describe('every door, window and fixture sits on a real, visible wall of its building', () => {
  for (const o of site.openings ?? []) {
    it(`${o.id}: on an outward wall, inside its length and height, not buried in another part`, () => {
      const [fx, fy] = o.facing;
      const tx = -fy, ty = fx; // along the wall
      const half = (o.widthFt ?? 0) / 2;
      const ends: Pt[] = [[o.at[0] - tx * half, o.at[1] - ty * half], [o.at[0] + tx * half, o.at[1] + ty * half]];
      const centerWalls = wallsAt(o.at, o.facing, 0.06);
      expect(centerWalls.length, 'is on no wall that faces that way').toBeGreaterThan(0);
      // both ends of its width are on a wall facing the same way (the wall may be several footprint edges)
      for (const e of ends) expect(wallsAt(e, o.facing, 0.06).length, `an end at ${e.map((v) => v.toFixed(2))} hangs past the wall`).toBeGreaterThan(0);
      // its top is under the wall's top
      const top = Math.max(...centerWalls.map((w) => w.top));
      expect((o.sillFt ?? 0) + (o.heightFt ?? 0), 'taller than the wall').toBeLessThanOrEqual(top + 0.05);
      // nothing stands in front of it that would hide it inside a neighbouring part (the open porch is not a body)
      const front: Pt = [o.at[0] + fx * 0.15, o.at[1] + fy * 0.15];
      const buried = structures.filter((s) => !s.open && pointInPolygon(front[0], front[1], s.footprint)).map((s) => s.id);
      expect(buried, 'inside another part of the building').toEqual([]);
    });
  }
});
