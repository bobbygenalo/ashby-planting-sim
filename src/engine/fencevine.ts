import type { BranchSegment } from './branches';
import type { FlowerSpec, LeafSpec } from './foliage';
import { mulberry32 } from './shuffle';
import type { Pt } from './types';

type Vec3 = [number, number, number];

/** How a climbing plant covers a fence (`fenceVine` in `engine.json`). Distances in feet. */
export interface FenceVineCfg {
  /** The stems lean from the plant's base to the fence over this much height. */
  climbFt: number;
  /** Leaves sit between these distances in front of the fence line. */
  planeDepthFt: [number, number];
  /** Once the plant is this share of its mature height it starts onto the boards beside the wire panels. */
  spillMinGrowth: number;
  /** The furthest it reaches along the boards beyond a panel's edge, fully grown. */
  spillFt: number;
  /** On boards it only reaches this share of the height it could. */
  spillHeightShare: number;
  /** It tops the wire by this much (it flops over). */
  overTopFt: number;
  /** A plant with no wire panel to climb stays this low. */
  unsupportedFt: number;
  stemRadiusFt: number;
  stemsMax: number;
  /** A side branch leaves a stem every this far. */
  branchEveryFt: number;
  branchLenFt: [number, number];
  maxLeaves: number;
  flowerShare: number;
  /** Leaves of a young plant are this share of full size. */
  youngLeafScale: number;
  /** How much the vine's height falls off toward the edges of its spread (0 none, 1 to nothing). */
  edgeTaper: number;
}

/** A stretch of the fence the plant can use: where it is and how tall (wire: its top; boards: the fence height). */
export interface Support { from: number; to: number; top: number }

export interface FenceVineInput {
  seed: number;
  /** The plant's own place along the fence, feet from the fence's start. */
  along: number;
  /** Its size now and when mature, feet. */
  height: number;
  width: number;
  matureHeight: number;
  /** Wire panels (what it climbs) and board stretches (what it spreads onto when grown), along the fence. */
  panels: Support[];
  boards: Support[];
  /** The fence's start, its unit direction and the unit vector toward the yard. */
  a: Pt;
  dir: Pt;
  yard: Pt;
  /** Where the plant stands (the result is in feet from here, Z up). */
  origin: Pt;
  leaf: { lengthFt: number; widthFt: number; perFt: number; displayScale: number };
  flower?: { sizeFt: number; displayScale: number };
  blooming: boolean;
}

export interface FenceVineResult {
  leaves: LeafSpec[];
  flowers: FlowerSpec[];
  segments: BranchSegment[];
  /** The stretch it covers along the fence (feet), how many leaves are on boards (not wire), and the tallest point. */
  reach: { from: number; to: number; leavesOnBoards: number; topFt: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A climbing plant on a fence, pure and seeded by the plant's id. Its stems lean from its base to the fence and fan up the wire
 * panel, branching as they go, with leaves along every stem and flowers while it blooms. The wire holds it: it covers a panel as
 * high as the panel plus a little. Only once it is grown (`spillMinGrowth` of its mature height) does it creep onto the boards
 * either side of the panel, further and further as it fills out, and lower than on the wire. A plant with no panel under it
 * stays low. All positions are plant-local feet (X east, Y toward the rear, Z up).
 */
export function fenceVineGrowth(inp: FenceVineInput, cfg: FenceVineCfg): FenceVineResult {
  const rng = mulberry32(inp.seed);
  const H = Math.max(inp.height, 0.2), W = Math.max(inp.width, 0.4);
  const g = clamp(inp.height / Math.max(inp.matureHeight, 0.5), 0, 1);
  const s0 = inp.along;
  const [dMin, dMax] = cfg.planeDepthFt;
  const d0 = (inp.origin[0] - inp.a[0]) * inp.yard[0] + (inp.origin[1] - inp.a[1]) * inp.yard[1];

  const inPanel = (s: number) => inp.panels.find((p) => s >= p.from - 1e-9 && s <= p.to + 1e-9);
  const toPanelEdge = (s: number) => inp.panels.reduce((m, p) => Math.min(m, s < p.from ? p.from - s : s > p.to ? s - p.to : 0), Infinity);
  const reachBoards = inp.panels.length && g >= cfg.spillMinGrowth ? (cfg.spillFt * (g - cfg.spillMinGrowth)) / (1 - cfg.spillMinGrowth) : 0;
  const boardsTop = (s: number) => inp.boards.find((b) => s >= b.from - 1e-9 && s <= b.to + 1e-9)?.top ?? 0;
  // its spread: its own width, plus the reach onto the boards once grown (a plant mid-panel only reaches the boards by this)
  const halfSpan = W / 2 + reachBoards;
  const allowed = (s: number) => {
    if (Math.abs(s - s0) > halfSpan + 1e-9) return false;
    if (!inp.panels.length) return Math.abs(s - s0) <= 0.8;
    return !!inPanel(s) || toPanelEdge(s) <= reachBoards;
  };
  /** How high the vine can be at s: wire top plus a little, on boards a share of the board height, thinning toward the spread's edges. */
  const topAt = (s: number) => {
    const panel = inPanel(s);
    let top = panel ? panel.top + cfg.overTopFt : inp.panels.length ? boardsTop(s) * cfg.spillHeightShare * (1 - 0.5 * clamp(toPanelEdge(s) / Math.max(cfg.spillFt, 0.1), 0, 1)) : cfg.unsupportedFt;
    top = Math.min(top, H);
    const u = clamp(Math.abs(s - s0) / halfSpan, 0, 1);
    return top * (1 - cfg.edgeTaper * u * u);
  };

  // where the vine can be: the allowed stretch around the plant
  let sl = Infinity, sr = -Infinity;
  for (let s = s0 - halfSpan; s <= s0 + halfSpan + 1e-9; s += 0.25) if (allowed(s) && topAt(s) > 0.3) { sl = Math.min(sl, s); sr = Math.max(sr, s); }
  if (!Number.isFinite(sl)) { sl = sr = s0; }

  const to3 = (s: number, z: number, d: number): Vec3 => [
    inp.a[0] + inp.dir[0] * s + inp.yard[0] * d - inp.origin[0],
    inp.a[1] + inp.dir[1] * s + inp.yard[1] * d - inp.origin[1],
    z,
  ];
  const upVec: Vec3 = [0, 0, 1];
  const alongVec: Vec3 = [inp.dir[0], inp.dir[1], 0];
  const yardVec: Vec3 = [inp.yard[0], inp.yard[1], 0];
  const planeDepth = () => dMin + rng() * (dMax - dMin);

  type P3 = { s: number; z: number; d: number };
  const segments: BranchSegment[] = [];
  const polylines: { pts: P3[]; r: number }[] = [];
  const addLine = (pts: P3[], r0: number, level: number) => {
    polylines.push({ pts, r: r0 });
    pts.slice(1).forEach((q, i) => {
      const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      segments.push({ a: to3(pts[i].s, pts[i].z, pts[i].d), b: to3(q.s, q.z, q.d), r0: r0 * (1 - 0.5 * t0), r1: r0 * (1 - 0.5 * t1), level });
    });
  };

  const K = clamp(2 + Math.floor((sr - sl) / 1.5), 2, cfg.stemsMax);
  const stemR = cfg.stemRadiusFt * (0.6 + 0.9 * g);
  const mains: P3[][] = [];
  for (let i = 0; i < K; i++) {
    const st = clamp(sl + ((i + 0.5) / K) * (sr - sl) + (rng() - 0.5) * 0.5, sl, sr);
    const zTop = Math.max(topAt(st) * (0.8 + 0.2 * rng()), 0.4);
    const plane = planeDepth();
    const phase = rng() * Math.PI * 2, sway = 0.1 + rng() * 0.12;
    const N = 10;
    const pts: P3[] = [];
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      const z = zTop * u;
      const lean = 1 - smooth(clamp(z / cfg.climbFt, 0, 1)); // 1 at the ground, 0 once up on the fence
      pts.push({ s: s0 + (st - s0) * Math.pow(u, 1.35) + Math.sin(u * Math.PI * 2 + phase) * sway * u, z, d: plane + (d0 - plane) * lean });
    }
    mains.push(pts);
    addLine(pts, stemR, 0);
  }

  // side branches off every main stem, kept to where the vine may be
  const branches: P3[][] = [];
  for (const m of mains) {
    let carried = 0, side = rng() < 0.5 ? 1 : -1;
    for (let k = 1; k < m.length; k++) {
      carried += Math.hypot(m[k].s - m[k - 1].s, m[k].z - m[k - 1].z);
      if (carried < cfg.branchEveryFt) continue;
      carried = 0;
      side = -side;
      const len = (cfg.branchLenFt[0] + rng() * (cfg.branchLenFt[1] - cfg.branchLenFt[0])) * (0.5 + 0.5 * Math.min(1, g * 1.5));
      const tx = m[k].s - m[k - 1].s, tz = m[k].z - m[k - 1].z, tl = Math.hypot(tx, tz) || 1;
      const ang = Math.atan2(tz / tl, tx / tl) + side * (0.6 + rng() * 0.6);
      let ls = len;
      let es = m[k].s + Math.cos(ang) * ls, ez = m[k].z + Math.sin(ang) * ls;
      for (let tries = 0; tries < 3 && (!allowed(es) || ez > topAt(es) || ez < 0.3); tries++) { ls *= 0.5; es = m[k].s + Math.cos(ang) * ls; ez = m[k].z + Math.sin(ang) * ls; }
      if (!allowed(es) || ez > topAt(es) || ez < 0.3 || ls < 0.2) continue;
      const d = m[k].d;
      const mid: P3 = { s: (m[k].s + es) / 2, z: (m[k].z + ez) / 2 + 0.05, d };
      const pts = [{ s: m[k].s, z: m[k].z, d }, mid, { s: es, z: ez, d }];
      branches.push(pts);
      addLine(pts, stemR * 0.55, 1);
    }
  }

  // leaves along every stem and branch, a flower on some while it blooms
  const grow = cfg.youngLeafScale + (1 - cfg.youngLeafScale) * Math.min(1, g * 1.6);
  const L = inp.leaf;
  const leaves: LeafSpec[] = [];
  const flowers: FlowerSpec[] = [];
  const lines = [...mains, ...branches];
  const total = lines.reduce((a, pts) => a + pts.slice(1).reduce((b, q, i) => b + Math.hypot(q.s - pts[i].s, q.z - pts[i].z), 0), 0);
  const keep = Math.min(1, cfg.maxLeaves / Math.max(1, total * L.perFt));
  for (const pts of lines) {
    let acc = rng() / L.perFt;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const seg = Math.hypot(b.s - a.s, b.z - a.z);
      for (; acc < seg; acc += 1 / L.perFt) {
        if (rng() > keep) continue;
        const t = acc / (seg || 1);
        const lateral = (rng() - 0.5) * 0.28, lift = (rng() - 0.5) * 0.2;
        const s = a.s + (b.s - a.s) * t + lateral;
        const z = a.z + (b.z - a.z) * t + lift;
        if (z < 0.15) continue;
        if (s < sl - 0.15 || s > sr + 0.15) continue;
        // near the ground the leaf follows its stem's lean; up on the fence it lies in the plane
        const stemD = a.d + (b.d - a.d) * t;
        const d = z < cfg.climbFt ? stemD + (rng() - 0.5) * 0.08 : planeDepth();
        const th = rng() * Math.PI * 2, ph = (rng() - 0.5) * 0.8;
        const c = Math.cos(ph);
        const dir: Vec3 = [
          alongVec[0] * Math.cos(th) * c + upVec[0] * Math.sin(th) * c + yardVec[0] * Math.sin(ph),
          alongVec[1] * Math.cos(th) * c + upVec[1] * Math.sin(th) * c + yardVec[1] * Math.sin(ph),
          alongVec[2] * Math.cos(th) * c + upVec[2] * Math.sin(th) * c + yardVec[2] * Math.sin(ph),
        ];
        const sc = grow * (0.8 + rng() * 0.4);
        const p = to3(s, z, d);
        leaves.push({ p, dir, roll: rng() * Math.PI * 2, length: L.lengthFt * L.displayScale * sc, width: L.widthFt * L.displayScale * sc, shade: rng(), under: rng() < 0.08 });
        if (inp.blooming && inp.flower && rng() < cfg.flowerShare) {
          const fd: Vec3 = [yardVec[0] + (rng() - 0.5) * 0.5, yardVec[1] + (rng() - 0.5) * 0.5, (rng() - 0.3) * 0.5];
          flowers.push({ p: to3(s, z, d + 0.03), dir: fd, size: inp.flower.sizeFt * inp.flower.displayScale * (0.8 + rng() * 0.4), form: 'petal', shade: rng() });
        }
      }
      acc -= seg;
    }
  }

  const onBoards = leaves.reduce((n, l) => {
    const along = (l.p[0] + inp.origin[0] - inp.a[0]) * inp.dir[0] + (l.p[1] + inp.origin[1] - inp.a[1]) * inp.dir[1];
    return n + (inPanel(along) ? 0 : 1);
  }, 0);
  const topFt = leaves.reduce((m, l) => Math.max(m, l.p[2]), 0);
  const along = (l: LeafSpec) => (l.p[0] + inp.origin[0] - inp.a[0]) * inp.dir[0] + (l.p[1] + inp.origin[1] - inp.a[1]) * inp.dir[1];
  const alongs = leaves.map(along);
  return {
    leaves, flowers, segments,
    reach: { from: alongs.length ? Math.min(...alongs) : s0, to: alongs.length ? Math.max(...alongs) : s0, leavesOnBoards: onBoards, topFt },
  };
}
