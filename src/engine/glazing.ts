import { bbox } from './geometry';
import { shedTopZ } from './site';
import type { Pt, Pt3, StructureCfg, WindowCfg } from './types';

/** One band of glass in a wall as flat geometry: the four corners of the glass and where its mullions run. */
export interface GlassBand {
  /** The wall's outward direction in plan (a unit vector). */
  normal: [number, number];
  /** The two ends of the glass along the wall, in plan (from the wall's lower-left end as seen from outside, to its other end). */
  from: Pt;
  to: Pt;
  /** Bottom-left, bottom-right, top-right, top-left, as seen from outside. */
  corners: [Pt3, Pt3, Pt3, Pt3];
  /** Each vertical mullion, with its place in plan and its bottom and top z; the end posts are the first and last. */
  mullions: { x: number; y: number; z0: number; z1: number }[];
}

/** The roof's height over a point of the wall: a shed roof's plane, a flat roof's top, the eave for anything else. */
const roofZ = (s: StructureCfg, x: number): number => (s.roofForm === 'shed' ? shedTopZ(s, x) : s.roofForm === 'flat' ? s.eaveHeight + 0.5 : s.eaveHeight);

/** The bands of glass a structure declares, laid in the plane of one of its walls, kept under the roof's underside by their gap. */
export function glassBands(s: StructureCfg): GlassBand[] {
  const f = bbox(s.footprint);
  return (s.windows ?? []).map((w) => band(s, w, f));
}

function band(s: StructureCfg, w: WindowCfg, f: { minX: number; maxX: number; minY: number; maxY: number }): GlassBand {
  // Under a roof slab that overhangs the front (and back) wall; the side walls run up to the roof's edge.
  const under = w.side === 'south' || w.side === 'north' ? (s.roofThickness ?? 0) : 0;
  // The wall as seen from outside, running left to right: its two ends and its outward direction.
  const [a, b, normal]: [Pt, Pt, [number, number]] =
    w.side === 'south' ? [[f.minX, f.minY], [f.maxX, f.minY], [0, -1]]
    : w.side === 'north' ? [[f.maxX, f.maxY], [f.minX, f.maxY], [0, 1]]
    : w.side === 'east' ? [[f.maxX, f.minY], [f.maxX, f.maxY], [1, 0]]
    : [[f.minX, f.maxY], [f.minX, f.minY], [-1, 0]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (t: number): Pt => [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
  const t0 = w.insetFt, t1 = len - w.insetFt;
  const top = (p: Pt) => roofZ(s, p[0]) - under - w.belowRoofFt;
  const bottom = (p: Pt) => top(p) - w.heightFt;
  const from = at(t0), to = at(t1);
  const n = Math.max(1, Math.round((t1 - t0) / w.mullionFt));
  const mullions = Array.from({ length: n + 1 }, (_, i) => {
    const p = at(t0 + ((t1 - t0) * i) / n);
    return { x: p[0], y: p[1], z0: bottom(p), z1: top(p) };
  });
  return {
    normal, from, to,
    corners: [[from[0], from[1], bottom(from)], [to[0], to[1], bottom(to)], [to[0], to[1], top(to)], [from[0], from[1], top(from)]],
    mullions,
  };
}
