import { canopyRadius, type CrownProfile } from './canopy';
import type { BranchSegment, Skeleton } from './branches';
import { mulberry32 } from './shuffle';
import type { BranchCfg, FoliageCfg, Habit, LookData } from './types';

type Vec3 = [number, number, number];

/** One leaf: where its stalk joins, which way its tip points, how it is turned about that line, and its size. */
export interface LeafSpec {
  p: Vec3;
  /** Unit vector from the stalk to the tip. */
  dir: Vec3;
  roll: number;
  /** Length and width, feet, display scale included. */
  length: number;
  width: number;
  /** 0 to 1, for a slight variation of color. */
  shade: number;
  /** Shows its underside. */
  under: boolean;
}

/** An arching blade (grass) or strap leaf (aloe), grown from its base along a bending line. */
export interface BladeSpec {
  base: Vec3;
  az: number;
  length: number;
  /** Angle of the start above the horizontal (radians) and how far the line bends over its length. */
  elev0: number;
  bend: number;
  /** Width at the widest, feet. */
  width: number;
  shade: number;
  shape: LookData['leaf']['shape'];
}

export interface Foliage {
  /** Woody limbs, or the soft stems of a perennial. */
  skeleton: Skeleton | null;
  leaves: LeafSpec[];
  blades: BladeSpec[];
  /** Where flowers can sit: twig tips, stem tips, blade middles, or the middle of a rosette. */
  anchors: Vec3[];
  /** How much larger than life the leaves were drawn because there were too many to draw. */
  inflate: number;
}

export interface FlowerSpec {
  p: Vec3;
  dir: Vec3;
  size: number;
  form: 'petal' | 'tube' | 'plume';
  /** Slight variation, 0 to 1. */
  shade: number;
}

export interface FoliageCtx {
  habit: Habit;
  /** Canopy radius, height of the bare trunk, canopy height, and the species' full-size radius and height, feet. */
  r: number;
  base: number;
  canopyH: number;
  matureR: number;
  matureH: number;
  seed: number;
  profile?: CrownProfile;
  branches: BranchCfg;
  cfg: FoliageCfg;
  /** Radius of the trunk where the limbs begin, feet. */
  trunkR?: number;
}

const GOLDEN = 2.399963229728653;
const between = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Half-width of a leaf, as a share of its widest, at a share `t` (0 base to 1 tip) of its length. Zero at the tip, one at its widest. */
export function leafWidthProfile(shape: LookData['leaf']['shape'], t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (shape) {
    case 'lanceolate': return Math.min(1, (Math.pow(1 - x, 0.85) * Math.pow(x, 0.4)) / 0.457) * (x < 0.03 ? x / 0.03 : 1);
    case 'elliptic': return Math.pow(Math.sin(Math.PI * x), 0.75);
    case 'oval': return Math.pow(Math.sin(Math.PI * Math.pow(x, 0.85)), 0.6);
    case 'strap': return x < 0.08 ? 0.55 + (x / 0.08) * 0.45 : x < 0.55 ? 1 : Math.max(0, 1 - ((x - 0.55) / 0.45) ** 1.6);
    case 'blade': return Math.max(0, 1 - x ** 1.3) * (x < 0.04 ? 0.6 + 0.4 * (x / 0.04) : 1);
    // A fern frond: a long leaf with the notched edge of its leaflets.
    case 'frond': return Math.min(1, Math.pow(Math.max(0, 1 - x), 0.9) * Math.pow(x, 0.35) / 0.47) * (0.72 + 0.28 * Math.abs(Math.sin(x * Math.PI * 9))) * (x < 0.03 ? x / 0.03 : 1);
  }
}

/** The points of a blade's bending center line, from its base to its tip. */
export function bladePoints(b: Pick<BladeSpec, 'base' | 'az' | 'length' | 'elev0' | 'bend'>, steps: number): Vec3[] {
  const pts: Vec3[] = [[b.base[0], b.base[1], b.base[2]]];
  const ds = b.length / steps;
  let [x, y, z] = b.base;
  for (let i = 0; i < steps; i++) {
    const e = b.elev0 - b.bend * ((i + 0.5) / steps) ** 1.3;
    x += Math.cos(b.az) * Math.cos(e) * ds;
    y += Math.sin(b.az) * Math.cos(e) * ds;
    z += Math.sin(e) * ds;
    pts.push([x, y, z]);
  }
  return pts;
}

/** Shorten a blade until every point is inside the radius and under the height. */
function fitBlade(b: BladeSpec, maxR: number, maxZ: number): BladeSpec {
  let length = b.length;
  for (let k = 0; k < 24; k++) {
    const pts = bladePoints({ ...b, length }, 12);
    const over = Math.max(Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))) / maxR, Math.max(...pts.map((p) => p[2])) / maxZ);
    if (over <= 1) break;
    length *= Math.max(0.5, 0.97 / over);
  }
  return { ...b, length: Math.max(length, 0.01) };
}

/**
 * A tree's branches filling its crown: twigs grow from the nearest existing branch toward points picked inside the
 * crown outline, the first few of them main limbs from the trunk top. Thickness follows how much each branch carries
 * (the pipe model), so limbs are stout and twigs thin. Returns the skeleton and the thin terminal segments that bear leaves.
 */
function crownSkeleton(ctx: FoliageCtx, look: LookData, rng: () => number, frac: number): { skeleton: Skeleton; twigSegments: BranchSegment[] } {
  const grounded = ctx.base <= 0.02;
  const root: Vec3 = [0, 0, ctx.base];
  const nodes: Vec3[] = [root];
  const parent: number[] = [-1];
  const target = Math.max(40, Math.round((look.twigs ?? 600) * frac ** 1.4));
  const step = Math.max(0.35, ctx.canopyH * 0.05);
  const insideCrown = (p: Vec3) => {
    const zf = (p[2] - ctx.base) / ctx.canopyH;
    return zf >= 0.02 && zf <= 0.99 && Math.hypot(p[0], p[1]) <= canopyRadius(ctx.habit, ctx.r, zf, grounded, ctx.profile) * 0.97;
  };
  const sample = (): Vec3 | null => {
    for (let k = 0; k < 30; k++) {
      const zf = between(rng, 0.05, 1);
      const R = canopyRadius(ctx.habit, ctx.r, zf, grounded, ctx.profile);
      if (R < ctx.r * 0.08 || rng() > (R / ctx.r) ** 2) continue;
      const az = rng() * Math.PI * 2, rr = R * Math.sqrt(rng()) * 0.95;
      return [Math.cos(az) * rr, Math.sin(az) * rr, ctx.base + zf * ctx.canopyH];
    }
    return null;
  };
  const growTo = (goal: Vec3) => {
    // The nearest existing node, then a line of nodes toward the goal, a little wobbly, kept inside the crown.
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i][0] - goal[0]) ** 2 + (nodes[i][1] - goal[1]) ** 2 + (nodes[i][2] - goal[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const from = nodes[best];
    const dist = Math.sqrt(bd);
    if (dist < step * 0.5) return;
    const n = Math.max(1, Math.round(dist / step));
    let prev = best;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const w = k === n ? 0 : step * 0.18;
      const p: Vec3 = [from[0] + (goal[0] - from[0]) * t + (rng() - 0.5) * w, from[1] + (goal[1] - from[1]) * t + (rng() - 0.5) * w, from[2] + (goal[2] - from[2]) * t + (rng() - 0.5) * w];
      if (k < n && !insideCrown(p)) break;
      nodes.push(p);
      parent.push(prev);
      prev = nodes.length - 1;
    }
  };
  // Main limbs first, spread around the trunk top and reaching well out.
  const limbs = Math.max(3, Math.round((look.limbs ?? 5) * (0.6 + 0.4 * frac)));
  for (let i = 0; i < limbs; i++) {
    const zf = between(rng, 0.35, 0.8);
    const R = canopyRadius(ctx.habit, ctx.r, zf, grounded, ctx.profile) * between(rng, 0.45, 0.8);
    const az = i * GOLDEN + (rng() - 0.5) * 0.4;
    growTo([Math.cos(az) * R, Math.sin(az) * R, ctx.base + zf * ctx.canopyH]);
  }
  for (let guard = 0; nodes.length < target * 1.6 && guard < target * 3; guard++) {
    const g = sample();
    if (g) growTo(g);
  }
  // How much each node carries: its own tip plus everything grown from it (children always come after their parent).
  const carry = new Array<number>(nodes.length).fill(1);
  for (let i = nodes.length - 1; i > 0; i--) carry[parent[i]] += carry[i];
  const tipR = Math.max(0.012, 0.004 * ctx.canopyH ** 0.6);
  const trunkR = ctx.trunkR ?? Math.max(tipR * 2, 0.012 * ctx.canopyH);
  const radius = (i: number) => Math.min(trunkR, tipR * Math.sqrt(carry[i]) * 0.85 * (ctx.trunkR ? 1.4 : 1));
  const segments: BranchSegment[] = [];
  const twigSegments: BranchSegment[] = [];
  const children = new Array<number>(nodes.length).fill(0);
  for (let i = 1; i < nodes.length; i++) children[parent[i]]++;
  const tips: Vec3[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const seg: BranchSegment = { a: nodes[parent[i]], b: nodes[i], r0: radius(parent[i]), r1: radius(i), level: carry[i] <= 6 ? 2 : 0 };
    segments.push(seg);
    if (carry[i] <= 6) twigSegments.push(seg);
    if (children[i] === 0) tips.push(nodes[i]);
  }
  return { skeleton: { segments, tips }, twigSegments };
}

const aim = (az: number, el: number): Vec3 => [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];

/**
 * A plant's leaves and the branches, stems or blades that carry them, from its size. Deterministic for a seed, and in
 * proportion to how grown the plant is. Leaves are drawn larger than life (`leafDisplayScale`), and fewer and larger
 * still when there would be more than `maxLeaves`.
 */
export function buildFoliage(look: LookData, ctx: FoliageCtx): Foliage {
  const rng = mulberry32(ctx.seed);
  const frac = Math.min(1, Math.max(0.05, ctx.r / Math.max(ctx.matureR, 0.01)));
  const grounded = ctx.base <= 0.02;
  const lf = look.leaf;
  const display = ctx.cfg.leafDisplayScale * (lf.display ?? 1);
  /** A young plant has fewer, somewhat smaller leaves. */
  const youngK = 0.55 + 0.45 * Math.sqrt(frac);
  const leaves: LeafSpec[] = [];
  const blades: BladeSpec[] = [];
  const anchors: Vec3[] = [];
  let skeleton: Skeleton | null = null;
  const topZ = ctx.base + ctx.canopyH;

  const leaf = (p: Vec3, dirIn: Vec3) => {
    const k = between(rng, 0.8, 1.2) * youngK;
    // A leaf never reaches below the ground: tip it up until its end clears the soil.
    let dir = dirIn;
    const reach = lf.lengthFt * display * k;
    if (p[2] + dir[2] * reach < 0.01) dir = norm([dir[0], dir[1], Math.max(dir[2], (0.01 - p[2]) / Math.max(reach, 1e-6))]);
    leaves.push({ p, dir, roll: rng() * Math.PI * 2, length: lf.lengthFt * display * k, width: lf.widthFt * display * k, shade: rng(), under: rng() < (lf.underShare ?? 0) });
  };
  /** Leaves along a segment of twig or stem, each turned out from it and drooping. */
  const along = (a: Vec3, b: Vec3, pairs: boolean) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-4) return;
    const axis = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const nodes = Math.max(1, Math.round((len * (lf.perFt ?? 12)) / (pairs ? 2 : 1)));
    const droop = lf.droop ?? 0.25;
    for (let i = 0; i < nodes; i++) {
      const t = 0.1 + 0.9 * ((i + rng() * 0.6) / nodes);
      const p = lerp3(a, b, Math.min(t, 1));
      const az0 = rng() * Math.PI * 2;
      for (let c = 0; c < (pairs ? 2 : 1); c++) {
        const out = aim(az0 + c * Math.PI, 0);
        const d = norm([out[0] * 0.8 + axis[0] * 0.55, out[1] * 0.8 + axis[1] * 0.55, out[2] * 0.8 + axis[2] * 0.55 - droop - (rng() - 0.5) * 0.5]);
        leaf(p, d);
      }
    }
  };

  if (look.kind === 'tree') {
    const sk = crownSkeleton(ctx, look, rng, frac);
    skeleton = sk.skeleton;
    // Leaves along the thin terminal twigs, and a little fan at the very end of each.
    sk.twigSegments.forEach((s) => along(s.a, s.b, false));
    for (const t of skeleton.tips) {
      anchors.push(t);
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) leaf(t, norm([...aim(rng() * Math.PI * 2, between(rng, -0.4, 0.5))] as Vec3));
    }
  } else if (look.kind === 'stems') {
    const n = Math.max(5, Math.round((look.count ?? 16) * frac ** 0.6));
    const segments: BranchSegment[] = [];
    const tips: Vec3[] = [];
    const thick = 0.02 + 0.012 * ctx.r;
    for (let i = 0; i < n; i++) {
      const az = i * GOLDEN + (rng() - 0.5) * 0.4;
      // Stems fan out to the whole outline, low ones reaching widest, so the bush is as wide as its data says.
      const zr = look.zRange ?? [0.25, 1];
      const zf = between(rng, zr[0], zr[1]);
      const R = canopyRadius(ctx.habit, ctx.r, zf, grounded, ctx.profile) * between(rng, 0.55, 0.97);
      const S: Vec3 = [Math.cos(az) * ctx.r * 0.08 * rng(), Math.sin(az) * ctx.r * 0.08 * rng(), 0];
      const T: Vec3 = [Math.cos(az) * R, Math.sin(az) * R, ctx.base + zf * ctx.canopyH];
      const C: Vec3 = [S[0] + (T[0] - S[0]) * 0.15, S[1] + (T[1] - S[1]) * 0.15, T[2] * 0.95];
      let prev = S;
      const steps = 5;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        const q: Vec3 = [u * u * S[0] + 2 * u * t * C[0] + t * t * T[0], u * u * S[1] + 2 * u * t * C[1] + t * t * T[1], u * u * S[2] + 2 * u * t * C[2] + t * t * T[2]];
        segments.push({ a: prev, b: q, r0: thick * (1 - 0.4 * (k - 1) / steps), r1: thick * (1 - 0.4 * k / steps), level: 1 });
        if (k > 1) along(prev, q, true);
        prev = q;
      }
      tips.push(T);
      anchors.push(T);
      // A rosette of leaves at the tip (aeonium): spiraling out, the middle ones standing up.
      const rl = look.tipRosette ?? 0;
      for (let k = 0; k < rl; k++) {
        const f = k / rl;
        leaf(T, aim(k * GOLDEN, 1.25 - 1.2 * f));
      }
    }
    skeleton = { segments, tips };
  } else {
    // Blades (grass) or the leaves of a rosette.
    const rosette = look.kind === 'rosette';
    const n = Math.max(6, Math.round((look.count ?? 40) * frac ** 0.6));
    for (let i = 0; i < n; i++) {
      const az = i * GOLDEN + rng() * 0.3;
      const f = i / n;
      const baseR = ctx.r * (rosette ? 0.05 : 0.15) * Math.sqrt(rng());
      const spec: BladeSpec = {
        base: [Math.cos(az) * baseR, Math.sin(az) * baseR, 0],
        az,
        length: (rosette ? ctx.r * between(rng, 1.0, 1.35) : ctx.canopyH * between(rng, 1.0, 1.5)),
        elev0: rosette ? 1.35 - 1.0 * f + (rng() - 0.5) * 0.15 : between(rng, 1.2, 1.5),
        bend: rosette ? between(rng, 0.3, 0.9) : between(rng, 0.7, 1.7),
        width: lf.widthFt * display * (rosette ? 0.45 + 0.55 * frac : 1),
        shade: rng(),
        shape: lf.shape,
      };
      const fit = fitBlade(spec, ctx.r * 0.98, ctx.canopyH * (look.leafHeightFrac ?? 1) * (rosette ? 1 : between(rng, 0.7, 1)));
      blades.push(fit);
      const pts = bladePoints(fit, 10);
      anchors.push(rosette ? [0, 0, ctx.canopyH * 0.55] : pts[6]);
    }
  }

  // Too many leaves to draw: keep a random share and draw them larger, within limits.
  let inflate = 1;
  if (leaves.length > ctx.cfg.maxLeaves) {
    inflate = Math.min(ctx.cfg.maxInflate, Math.sqrt(leaves.length / ctx.cfg.maxLeaves));
    for (let i = leaves.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
    }
    leaves.length = ctx.cfg.maxLeaves;
    for (const l of leaves) { l.length *= inflate; l.width *= inflate; }
  }
  void topZ;
  return { skeleton, leaves, blades, anchors, inflate };
}

/**
 * The flowers a plant carries while it blooms: blossoms on the twigs, spikes of tubes on stalks, tubes hanging from a
 * raceme, or slender plumes above grass. `stalks` are the thin stems that carry spikes, racemes and plumes.
 */
export function buildFlowers(look: LookData, fol: Foliage, ctx: FoliageCtx): { flowers: FlowerSpec[]; stalks: BranchSegment[] } {
  const f = look.flower;
  const flowers: FlowerSpec[] = [];
  const stalks: BranchSegment[] = [];
  if (!f || fol.anchors.length === 0) return { flowers, stalks };
  const rng = mulberry32((ctx.seed ^ 0x9e3779b1) >>> 0);
  const frac = Math.min(1, Math.max(0.05, ctx.r / Math.max(ctx.matureR, 0.01)));
  const size = f.sizeFt * ctx.cfg.flowerDisplayScale;
  const anchors = fol.anchors;
  const pick = (i: number) => anchors[i % anchors.length];
  const stalkLen = (f.stalkFt ?? 1) * (0.45 + 0.55 * frac);

  if (f.form === 'blossom') {
    const n = Math.min(anchors.length * 2, Math.max(3, Math.round(f.count * frac ** 1.5)));
    for (let i = 0; i < n; i++) {
      const a = pick(i * 7 + Math.floor(rng() * anchors.length));
      const j = size * 0.8;
      // Blossoms sit a little out from the twig tip, on the outside of the crown, where they show.
      const out = Math.hypot(a[0], a[1]) || 1;
      const push = size * 0.9;
      flowers.push({ p: [a[0] + (a[0] / out) * push + (rng() - 0.5) * j, a[1] + (a[1] / out) * push + (rng() - 0.5) * j, a[2] + (rng() - 0.5) * j], dir: norm([...aim(rng() * Math.PI * 2, between(rng, 0.1, 1.2))] as Vec3), size: size * between(rng, 0.8, 1.2), form: 'petal', shade: rng() });
    }
  } else if (f.form === 'head') {
    // Round or flat heads of small flowers on stalks: from the stem tips, or up from the base of a clump of leaves.
    const n = Math.max(2, Math.round((f.heads ?? 6) * frac ** 0.8));
    const fromBase = ctx.matureH > 0 && (look.kind === 'blades' || look.kind === 'rosette');
    const hr = (f.headFt ?? f.sizeFt * 3) * ctx.cfg.flowerDisplayScale * (0.5 + 0.5 * frac);
    for (let i = 0; i < n; i++) {
      const a = pick(Math.floor(rng() * anchors.length));
      const az = rng() * Math.PI * 2;
      const baseP: Vec3 = fromBase ? [Math.cos(az) * ctx.r * 0.1 * rng(), Math.sin(az) * ctx.r * 0.1 * rng(), 0] : [a[0], a[1], a[2]];
      const lean = stalkLen * between(rng, 0.05, 0.3) * (fromBase ? 1.5 : 1);
      const topZ = fromBase ? ctx.canopyH * between(rng, 0.85, 1.05) : a[2] + stalkLen * between(rng, 0.6, 1);
      const top: Vec3 = [baseP[0] + Math.cos(az) * lean, baseP[1] + Math.sin(az) * lean, Math.max(topZ, baseP[2] + hr)];
      stalks.push({ a: baseP, b: top, r0: 0.02, r1: 0.012, level: 0 });
      const m = Math.max(5, Math.round(f.count * (0.5 + 0.5 * frac)));
      for (let k = 0; k < m; k++) {
        // Spread over a dome (or a flat plate) by a spiral, so the head is even.
        const t = (k + 0.5) / m;
        const rr = hr * Math.sqrt(t), ang = k * GOLDEN;
        const lift = f.flat ? 0 : hr * Math.sqrt(Math.max(0, 1 - t)) * 0.9;
        const p: Vec3 = [top[0] + Math.cos(ang) * rr, top[1] + Math.sin(ang) * rr, top[2] + lift];
        const out = norm([Math.cos(ang) * rr, Math.sin(ang) * rr, lift + hr * 0.3]);
        flowers.push({ p, dir: f.unit === 'tube' ? out : norm([out[0] * 0.4, out[1] * 0.4, 1]), size: size * between(rng, 0.85, 1.15), form: f.unit === 'tube' ? 'tube' : 'petal', shade: rng() });
      }
    }
  } else if (f.form === 'plume') {
    const n = Math.max(3, Math.round(f.count * frac));
    for (let i = 0; i < n; i++) {
      const a = pick(Math.floor(rng() * anchors.length));
      const az = Math.atan2(a[1], a[0]) + (rng() - 0.5) * 0.8;
      const lean = between(rng, 0.1, 0.35) * stalkLen;
      const top: Vec3 = [a[0] + Math.cos(az) * lean, a[1] + Math.sin(az) * lean, Math.max(a[2] + stalkLen * between(rng, 0.6, 1), ctx.canopyH * 1.05)];
      stalks.push({ a: [a[0], a[1], a[2]], b: top, r0: 0.012, r1: 0.008, level: 0 });
      flowers.push({ p: top, dir: norm([Math.cos(az) * 0.25, Math.sin(az) * 0.25, 1]), size: size * between(rng, 0.9, 1.2), form: 'plume', shade: rng() });
    }
  } else {
    // A spike or a raceme: a stalk with flowers up its upper part.
    const hanging = f.form === 'raceme';
    const spikes = f.heads !== undefined ? Math.max(1, Math.round(f.heads * frac ** 0.8)) : anchors.length === 1 ? Math.max(1, Math.round(2 * frac)) : Math.max(1, Math.round(anchors.length * 0.8));
    const fromBase = look.kind === 'blades' || look.kind === 'rosette';
    for (let s = 0; s < spikes; s++) {
      // On a clump of leaves the stalk rises from the middle, past the leaves; on a bush it grows from a stem tip.
      const a = fromBase ? ([(rng() - 0.5) * ctx.r * 0.2, (rng() - 0.5) * ctx.r * 0.2, 0] as Vec3) : anchors.length === 1 ? ([(rng() - 0.5) * ctx.r * 0.3, (rng() - 0.5) * ctx.r * 0.3, ctx.canopyH * 0.5] as Vec3) : pick(Math.floor(rng() * anchors.length));
      const az = rng() * Math.PI * 2;
      const lean = stalkLen * between(rng, 0.05, 0.2) * (fromBase ? 2 : 1);
      const top: Vec3 = [a[0] + Math.cos(az) * lean, a[1] + Math.sin(az) * lean, fromBase ? ctx.canopyH * (look.leafHeightFrac ?? 1) + stalkLen * between(rng, 0.6, 1) : a[2] + stalkLen * between(rng, 0.85, 1)];
      stalks.push({ a: [a[0], a[1], a[2]], b: top, r0: 0.02, r1: 0.012, level: 0 });
      const m = Math.max(4, Math.round(f.count * (0.5 + 0.5 * frac)));
      const perNode = hanging ? 1 : 3;
      for (let k = 0; k < m; k++) {
        const p = lerp3(a, top, 0.3 + 0.7 * ((k + 0.5) / m));
        for (let c = 0; c < perNode; c++) {
          const ang = k * GOLDEN + (c * Math.PI * 2) / perNode;
          const dir = hanging ? norm([Math.cos(ang) * 0.7, Math.sin(ang) * 0.7, -0.65]) : norm([Math.cos(ang) * 0.8, Math.sin(ang) * 0.8, 0.5]);
          flowers.push({ p, dir, size: size * between(rng, 0.85, 1.15), form: 'tube', shade: rng() });
        }
      }
    }
  }
  return { flowers, stalks };
}

/** Quantize a size onto a logarithmic ladder so a growing plant is rebuilt only now and then. */
export function quantizeSize(x: number, step: number, floor = 0.05): number {
  const v = Math.max(x, floor);
  return Math.exp(Math.round(Math.log(v) / step) * step);
}
