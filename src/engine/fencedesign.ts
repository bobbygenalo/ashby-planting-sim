import { mulberry32 } from './shuffle';
import type { Pt, SiteConfig } from './types';

export interface Range { min: number; max: number; step: number; default?: number }

/** A material a stretch of fence can be made of: boards in a bay between posts, or a wire panel. */
export interface FenceMaterial {
  id: string;
  label: string;
  kind: 'boards' | 'wire';
  color: string;
  /** Widths one block of this material comes in, feet (boards in bays of 2 to 8 ft, wire in 4 ft steps). */
  widthsFt: number[];
  /** Wire only: the preset panel height and grid, inches. */
  heightIn?: number;
  gridWidthIn?: number;
  gridHeightIn?: number;
}

/** Limits, stock sizes and defaults for the customizable fence (`fenceDesign` in `engine.json`). */
export interface FenceDesignCfg {
  /** The context fence this design replaces. */
  targetId: string;
  postIn: number;
  boardThicknessIn: number;
  railIn: [number, number];
  railCount: number;
  railInsetFt: number;
  boardNominalIn: number[];
  /** Real width of a 1xN board by its nominal N (a 1x6 is 5.5 in). */
  boardActualIn: Record<string, number>;
  boardNominalDefault: number;
  boardGapIn: Range;
  /** Heights the board fence comes in, feet (6 or 8). */
  boardHeightFt: { options: number[]; default: number };
  /** A post stands this much above the tallest stretch it holds. */
  postRiseFt: number;
  materials: FenceMaterial[];
  /** What the fence is made of where no block says otherwise: boards of this material in bays between posts. */
  fill: { material: string; bayFt: { options: number[]; default: number } };
  defaultBlocks: { material: string; widthFt: number; atFt: number }[];
  /** The one-click buttons that add a block: its label, material and width. */
  quickAdd: { label: string; material: string; widthFt: number }[];
  maxBlocks: number;
  blockStepFt: number;
  panelHeightIn: Omit<Range, 'default'>;
  panelBottomFt: Range;
  gridIn: Omit<Range, 'default'>;
  /** Share of light a wire panel lets through, for the sun model. */
  panelOpenShare: number;
  wireIn: number;
  wireDisplayScale: number;
  maxWires: number;
  vine: { spacingFt: Range; offsetFt: number; /** Where it roots instead when `offsetFt` is taken (the strip between the fence and a driveway): closer in. */ tightOffsetFt: number; idPrefix: string };
  colors: { post: string; rail: string };
}

/**
 * One block of fence: a stretch of one material, `widthFt` wide, starting `atFt` along the fence from its front end. Boards
 * fill a single bay between two posts; wire is one panel. Settings left out take the fence's defaults (boards) or the
 * material's preset (wire).
 */
export interface FenceBlock {
  id: string;
  material: string;
  atFt: number;
  widthFt: number;
  boardNominalIn?: number;
  boardGapIn?: number;
  /** Boards only: 6 or 8 ft tall (the posts rise with them). */
  heightFt?: number;
  heightIn?: number;
  gridWidthIn?: number;
  gridHeightIn?: number;
  bottomFt?: number;
  /** Wire only: climbing plants are set out along this panel (the fence's chosen species, `vines`). */
  climbers?: boolean;
}

/** What the owner chose for the west fence. Saved with the scenario. */
export interface FenceDesign {
  /** Blocks placed along the fence, kept in order along it and never overlapping. Everywhere else is the fill. */
  blocks: FenceBlock[];
  /** The fill: boards of `fillMaterial`, `fillBayFt` between posts, this size and gap. */
  fillMaterial: string;
  fillBayFt: number;
  boardNominalIn: number;
  boardGapIn: number;
  /** Height of the fill's boards, feet. */
  fillHeightFt: number;
  /** Species planted to climb the wire panels (ids), alternating in this order. */
  vines: string[];
  vineSpacingFt: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const snap = (v: number, r: { min: number; max: number; step: number }) => clamp(Math.round((v - r.min) / r.step) * r.step + r.min, r.min, r.max);
const nearest = (v: number, options: number[]) => options.reduce((b, o) => (Math.abs(o - v) < Math.abs(b - v) ? o : b), options[0]);

export function materialOf(cfg: FenceDesignCfg, id: string): FenceMaterial | undefined {
  return cfg.materials.find((m) => m.id === id);
}

export function defaultFenceDesign(cfg: FenceDesignCfg): FenceDesign {
  const blocks = cfg.defaultBlocks.map((b, i) => ({ id: `b${i + 1}`, ...b }));
  return {
    blocks,
    fillMaterial: cfg.fill.material,
    fillBayFt: cfg.fill.bayFt.default,
    boardNominalIn: cfg.boardNominalDefault,
    boardGapIn: cfg.boardGapIn.default ?? 0.25,
    fillHeightFt: cfg.boardHeightFt.default,
    vines: [],
    vineSpacingFt: cfg.vine.spacingFt.default ?? 4,
  };
}

/** A block with its values forced into range (or undefined when its material is unknown). */
function cleanBlock(raw: unknown, cfg: FenceDesignCfg, lengthFt: number, fallbackId: string): FenceBlock | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const mat = typeof r.material === 'string' ? materialOf(cfg, r.material) : undefined;
  if (!mat) return undefined;
  const b: FenceBlock = {
    id: typeof r.id === 'string' && r.id ? r.id : fallbackId,
    material: mat.id,
    widthFt: nearest(num(r.widthFt, mat.widthsFt[0]), mat.widthsFt),
    atFt: clamp(num(r.atFt, 0), 0, lengthFt),
  };
  const opt = (k: keyof FenceBlock, v: number | undefined) => { if (v !== undefined) (b as unknown as Record<string, number>)[k] = v; };
  if (mat.kind === 'boards') {
    if (typeof r.boardNominalIn === 'number' && cfg.boardNominalIn.includes(r.boardNominalIn)) b.boardNominalIn = r.boardNominalIn;
    if (typeof r.boardGapIn === 'number') opt('boardGapIn', snap(r.boardGapIn, cfg.boardGapIn));
    if (typeof r.heightFt === 'number') opt('heightFt', nearest(r.heightFt, cfg.boardHeightFt.options));
  } else {
    if (typeof r.heightIn === 'number') opt('heightIn', snap(r.heightIn, cfg.panelHeightIn));
    if (typeof r.gridWidthIn === 'number') opt('gridWidthIn', snap(r.gridWidthIn, cfg.gridIn));
    if (typeof r.gridHeightIn === 'number') opt('gridHeightIn', snap(r.gridHeightIn, cfg.gridIn));
    if (typeof r.bottomFt === 'number') opt('bottomFt', snap(r.bottomFt, cfg.panelBottomFt));
    if (r.climbers === true) b.climbers = true;
  }
  return b;
}

/**
 * Blocks in order along the fence, none overlapping (a block that would start inside the one before is pushed to its end) and
 * none past the fence's end (the last is cut short, or dropped when under a quarter foot would be left).
 */
export function packBlocks(blocks: FenceBlock[], cfg: FenceDesignCfg, lengthFt: number): FenceBlock[] {
  const out: FenceBlock[] = [];
  let end = 0;
  for (const b of [...blocks].sort((a, c) => a.atFt - c.atFt)) {
    const at = Math.max(b.atFt, end);
    if (lengthFt - at < 0.25) continue;
    // a block cut short at the fence's end takes the widest size of its material that still fits
    const mat = materialOf(cfg, b.material);
    const fits = (mat?.widthsFt ?? []).filter((w) => at + w <= lengthFt + 1e-9);
    const width = at + b.widthFt <= lengthFt + 1e-9 ? b.widthFt : fits.length ? Math.max(...fits) : lengthFt - at;
    out.push({ ...b, atFt: at, widthFt: width });
    end = at + width;
  }
  return out;
}

/** A design from anything saved: every value forced into its allowed range, missing ones taken from the default. */
export function sanitizeFenceDesign(raw: unknown, cfg: FenceDesignCfg, lengthFt: number): FenceDesign {
  const d = defaultFenceDesign(cfg);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawBlocks = Array.isArray(r.blocks) ? r.blocks : d.blocks;
  const cleaned: FenceBlock[] = [];
  rawBlocks.forEach((b, i) => {
    const c = cleanBlock(b, cfg, lengthFt, `b${i + 1}`);
    if (c && cleaned.length < cfg.maxBlocks) cleaned.push({ ...c, id: cleaned.some((x) => x.id === c.id) ? `b${cleaned.length + 1}_${i}` : c.id });
  });
  const fill = typeof r.fillMaterial === 'string' && materialOf(cfg, r.fillMaterial)?.kind === 'boards' ? r.fillMaterial : d.fillMaterial;
  return {
    blocks: packBlocks(cleaned, cfg, lengthFt),
    fillMaterial: fill,
    fillBayFt: cfg.fill.bayFt.options.includes(num(r.fillBayFt, NaN)) ? (r.fillBayFt as number) : d.fillBayFt,
    boardNominalIn: cfg.boardNominalIn.includes(num(r.boardNominalIn, NaN)) ? (r.boardNominalIn as number) : d.boardNominalIn,
    boardGapIn: snap(num(r.boardGapIn, d.boardGapIn), cfg.boardGapIn),
    fillHeightFt: cfg.boardHeightFt.options.includes(num(r.fillHeightFt, NaN)) ? (r.fillHeightFt as number) : d.fillHeightFt,
    vines: Array.isArray(r.vines) ? (r.vines.filter((v) => typeof v === 'string') as string[]) : [],
    vineSpacingFt: snap(num(r.vineSpacingFt, d.vineSpacingFt), cfg.vine.spacingFt),
  };
}

/** The next block id not already used. */
export function nextBlockId(d: Pick<FenceDesign, 'blocks'>): string {
  let n = d.blocks.length + 1;
  while (d.blocks.some((b) => b.id === `b${n}`)) n++;
  return `b${n}`;
}

/** The real width of one board of a 1xN, in feet. */
export function boardWidthFt(nominalIn: number, cfg: FenceDesignCfg): number {
  return (cfg.boardActualIn[String(nominalIn)] ?? nominalIn) / 12;
}

/** The share of a board stretch that is wood: board over board plus gap. */
export function boardDensity(nominalIn: number, gapIn: number, cfg: FenceDesignCfg): number {
  const w = boardWidthFt(nominalIn, cfg);
  return w / (w + gapIn / 12);
}

/** One stretch of the fence between two posts, fully resolved for drawing. */
export interface Segment {
  kind: 'boards' | 'wire';
  from: number;
  to: number;
  /** The block it comes from; none for the fill. */
  blockId?: string;
  material: string;
  color: string;
  boardNominalIn: number;
  boardGapIn: number;
  /** Boards: how tall the fence is here, feet. Wire: how tall the panel is. */
  heightFt: number;
  /** Wire only. */
  bottomFt: number;
  gridWidthIn: number;
  gridHeightIn: number;
}

export interface PanelPlace { from: number; to: number; bottomFt: number; heightFt: number; verticals: number; horizontals: number; gridWidthIn: number; gridHeightIn: number; blockId?: string; material: string; color: string }
export interface BoardPlace { at: number; widthFt: number; heightFt: number; color: string }
export interface RailPlace { from: number; to: number; z: number }

export interface FenceLayout {
  /** The fence from start to end with no gap: the fill's bays, and each block as one bay or panel. Boards and wire never share a stretch. */
  segments: Segment[];
  /** Distances along the fence (feet from its start) of each post: one at every segment boundary. */
  posts: number[];
  boards: BoardPlace[];
  panels: PanelPlace[];
  wires: number;
  /** Rails under the boards, each stretch with its own heights (an 8 ft fence has its rails higher). */
  rails: RailPlace[];
  /** How tall each post is (parallel to `posts`): the tallest stretch it holds, and a little more. */
  postHeights: number[];
}

/** Everything the scene needs to draw the fence along a run `lengthFt` long (heights come from the design). Pure. */
export function fenceLayout(d: FenceDesign, lengthFt: number, cfg: FenceDesignCfg): FenceLayout {
  const fillMat = materialOf(cfg, d.fillMaterial) ?? cfg.materials.find((m) => m.kind === 'boards')!;
  const segments: Segment[] = [];
  const base = { boardNominalIn: d.boardNominalIn, boardGapIn: d.boardGapIn, heightFt: d.fillHeightFt, bottomFt: 0, gridWidthIn: 0, gridHeightIn: 0 };
  const fill = (from: number, to: number) => {
    for (let x = from; x < to - 1e-6; x += d.fillBayFt) segments.push({ ...base, kind: 'boards', from: x, to: Math.min(to, x + d.fillBayFt), material: fillMat.id, color: fillMat.color });
  };
  let at = 0;
  for (const b of packBlocks(d.blocks, cfg, lengthFt)) {
    const mat = materialOf(cfg, b.material);
    if (!mat) continue;
    fill(at, b.atFt);
    const to = Math.min(lengthFt, b.atFt + b.widthFt);
    if (mat.kind === 'boards') {
      segments.push({ ...base, kind: 'boards', from: b.atFt, to, blockId: b.id, material: mat.id, color: mat.color, boardNominalIn: b.boardNominalIn ?? d.boardNominalIn, boardGapIn: b.boardGapIn ?? d.boardGapIn, heightFt: b.heightFt ?? d.fillHeightFt });
    } else {
      segments.push({ ...base, kind: 'wire', from: b.atFt, to, blockId: b.id, material: mat.id, color: mat.color, heightFt: (b.heightIn ?? mat.heightIn ?? 36) / 12, bottomFt: b.bottomFt ?? cfg.panelBottomFt.default ?? 0, gridWidthIn: b.gridWidthIn ?? mat.gridWidthIn ?? 4, gridHeightIn: b.gridHeightIn ?? mat.gridHeightIn ?? 4 });
    }
    at = to;
  }
  fill(at, lengthFt);

  const boards: BoardPlace[] = [];
  const panels: PanelPlace[] = [];
  for (const sg of segments) {
    if (sg.kind === 'boards') {
      const w = boardWidthFt(sg.boardNominalIn, cfg);
      const pitch = w + sg.boardGapIn / 12;
      for (let x = sg.from + w / 2; x <= sg.to - w / 2 + 1e-9; x += pitch) boards.push({ at: x, widthFt: w, heightFt: sg.heightFt, color: sg.color });
    } else {
      panels.push({
        from: sg.from, to: sg.to, bottomFt: sg.bottomFt, heightFt: sg.heightFt, blockId: sg.blockId, material: sg.material, color: sg.color,
        gridWidthIn: sg.gridWidthIn, gridHeightIn: sg.gridHeightIn,
        verticals: Math.floor(((sg.to - sg.from) * 12) / sg.gridWidthIn) + 1,
        horizontals: Math.floor((sg.heightFt * 12) / sg.gridHeightIn) + 1,
      });
    }
  }
  const posts = [...new Set(segments.flatMap((sg) => [sg.from, sg.to]).map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
  const top = (sg: Segment) => (sg.kind === 'boards' ? sg.heightFt : sg.bottomFt + sg.heightFt);
  const postHeights = posts.map((x) => Math.max(...segments.filter((sg) => Math.abs(sg.from - x) < 1e-5 || Math.abs(sg.to - x) < 1e-5).map(top)) + cfg.postRiseFt);
  const rails: RailPlace[] = [];
  for (const sg of segments) {
    if (sg.kind !== 'boards') continue;
    for (let i = 0; i < cfg.railCount; i++) rails.push({ from: sg.from, to: sg.to, z: cfg.railInsetFt + (i * (sg.heightFt - 2 * cfg.railInsetFt)) / Math.max(1, cfg.railCount - 1) });
  }
  return { segments, posts, postHeights, boards, panels, wires: panels.reduce((a, p) => a + p.verticals + p.horizontals, 0), rails };
}

/** The share of light the whole fence blocks: boards by their gaps, wire panels by how open they are, weighted by length. */
export function fenceDensity(d: FenceDesign, lengthFt: number, cfg: FenceDesignCfg): number {
  const l = fenceLayout(d, lengthFt, cfg);
  const total = l.segments.reduce((a, sg) => a + sg.to - sg.from, 0) || 1;
  return l.segments.reduce((a, sg) => a + (sg.to - sg.from) * (sg.kind === 'boards' ? boardDensity(sg.boardNominalIn, sg.boardGapIn, cfg) : 1 - cfg.panelOpenShare), 0) / total;
}

/**
 * Mix the blocks up: the same blocks in a new order, packed one after another from where the first one started. The same seed
 * gives the same order, and with two or more blocks the order is never left as it was. Pure.
 */
export function shuffleBlocks(d: FenceDesign, seed: number, cfg: FenceDesignCfg, lengthFt: number): FenceDesign {
  const sorted = packBlocks(d.blocks, cfg, lengthFt);
  if (sorted.length < 2) return { ...d, blocks: sorted };
  const rng = mulberry32(seed);
  const key = (b: FenceBlock) => `${b.material}:${b.widthFt}`;
  const sameOrder = (a: FenceBlock[]) => a.every((b, i) => b.id === sorted[i].id);
  // blocks that look alike (same material and width) can swap without changing the fence, so judge "left as it was" by look
  const look = (a: FenceBlock[]) => a.map(key).join('|');
  const distinct = new Set(sorted.map(key)).size > 1;
  let order = sorted;
  for (let tries = 0; tries < 20; tries++) {
    const a = [...sorted];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    order = a;
    if (!distinct ? !sameOrder(a) : look(a) !== look(sorted)) break;
  }
  let at = sorted[0].atFt;
  const placed = order.map((b) => { const p = { ...b, atFt: at }; at += b.widthFt; return p; });
  return sanitizeFenceDesign({ ...d, blocks: placed }, cfg, lengthFt);
}

export interface VineSpot { speciesId: string; /** Where it roots, `offsetFt` into the yard. */ at: Pt; /** The closer spot (`tightOffsetFt`), for where the first is taken. */ tight: Pt; along: number }

/**
 * Where the climbing plants go: along each wire panel that has `climbers` on, one every `vineSpacingFt` (the first half a space in), the chosen species
 * taking turns, `offsetFt` into the yard from the fence. `a` and `b` are the fence's ends; the yard is to the right of `a` to `b`.
 */
export function vineSpots(d: FenceDesign, a: Pt, b: Pt, cfg: FenceDesignCfg, layout: FenceLayout): VineSpot[] {
  const wanted = new Set(d.blocks.filter((b) => b.climbers).map((b) => b.id));
  const panels = layout.panels.filter((p) => p.blockId && wanted.has(p.blockId));
  if (!d.vines.length || !panels.length) return [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const yard: Pt = [dir[1], -dir[0]];
  const out: VineSpot[] = [];
  let k = 0;
  for (const p of panels) {
    for (let s = p.from + d.vineSpacingFt / 2; s < p.to - 1e-9; s += d.vineSpacingFt) {
      const at = (o: number): Pt => [a[0] + dir[0] * s + yard[0] * o, a[1] + dir[1] * s + yard[1] * o];
      out.push({ speciesId: d.vines[k++ % d.vines.length], along: s, at: at(cfg.vine.offsetFt), tight: at(cfg.vine.tightOffsetFt) });
    }
  }
  return out;
}

/** The fence the design applies to: its two ends, length and height, or undefined when the site has no such fence. */
export function fenceRun(site: Pick<SiteConfig, 'contextObjects'>, cfg: Pick<FenceDesignCfg, 'targetId'>): { a: Pt; b: Pt; lengthFt: number; heightFt: number } | undefined {
  const o = site.contextObjects.find((c) => c.id === cfg.targetId);
  const line = o?.line;
  if (!o || !line || line.length !== 2) return undefined;
  return { a: line[0], b: line[1], lengthFt: Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]), heightFt: o.height };
}

/**
 * The fence as separate pieces for the sun model: each stretch a fence of its own height (boards by their height, a wire panel up
 * to its top) and the share of light it blocks (boards by their gaps, wire by how open it is). `run` is the fence's two ends.
 */
export function fenceSunPieces(d: FenceDesign, run: { a: Pt; b: Pt; lengthFt: number; heightFt: number }, cfg: FenceDesignCfg): { id: string; line: [Pt, Pt]; height: number; density: number }[] {
  const dir: Pt = [(run.b[0] - run.a[0]) / run.lengthFt, (run.b[1] - run.a[1]) / run.lengthFt];
  const at = (s: number): Pt => [run.a[0] + dir[0] * s, run.a[1] + dir[1] * s];
  return fenceLayout(d, run.lengthFt, cfg).segments.map((sg, i) => ({
    id: `${cfg.targetId}~${i}`,
    line: [at(sg.from), at(sg.to)],
    height: sg.kind === 'boards' ? sg.heightFt : sg.bottomFt + sg.heightFt,
    density: sg.kind === 'boards' ? boardDensity(sg.boardNominalIn, sg.boardGapIn, cfg) : 1 - cfg.panelOpenShare,
  }));
}
