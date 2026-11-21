import {
  bbox, circleOverlapsPolygon, distanceToSegment, lineToPolygon, perimeter, pointInPolygon,
  polygonArea, polygonsIntersect, polylineLength, triangulate,
} from './geometry';
import type { Solid } from './site';
import type { EngineConfig, HardscapeElement, Material, Pt, Pt3, SiteConfig, StructureCfg } from './types';

type HsCfg = EngineConfig['hardscape'];

export const isLineElement = (el: HardscapeElement, cfg: HsCfg) => cfg.types[el.type].shape === 'line';

/** Ground outline of an element: the polygon itself, or the thickened polyline. */
export function footprint(el: HardscapeElement, cfg: HsCfg): Pt[] {
  return isLineElement(el, cfg) ? lineToPolygon(el.points, el.width) : el.points;
}

export interface ElementMetrics {
  areaSf: number;
  edgeLf: number;
  surfaceCuYd: number;
  baseCuYd: number;
}

const cuYd = (areaSf: number, depthIn: number) => (areaSf * (depthIn / 12)) / 27;

/**
 * Quantities for one element. Polygons: area, perimeter. Lines: length, and area = length x width.
 * Surface volume uses the element's depth; base volume uses the material's base (or footing) depth.
 */
export function elementMetrics(el: HardscapeElement, mat: Material, cfg: HsCfg): ElementMetrics {
  const line = isLineElement(el, cfg);
  const areaSf = line ? polylineLength(el.points) * el.width : polygonArea(el.points);
  const edgeLf = line ? polylineLength(el.points) : perimeter(el.points);
  return { areaSf, edgeLf, surfaceCuYd: cuYd(areaSf, el.depthIn), baseCuYd: cuYd(areaSf, mat.baseDepthIn) };
}

export interface TakeoffRow {
  materialId: string;
  name: string;
  unit: 'sf' | 'lf';
  count: number;
  areaSf: number;
  edgeLf: number;
  surfaceCuYd: number;
  baseCuYd: number;
}

/** Materials takeoff for new work: existing and removed elements are excluded (HS-4). */
export function takeoff(elements: HardscapeElement[], materials: Material[], cfg: HsCfg): { rows: TakeoffRow[]; total: Omit<TakeoffRow, 'materialId' | 'name' | 'unit'> } {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rows = new Map<string, TakeoffRow>();
  for (const el of elements) {
    if (el.existing || el.removed) continue;
    const mat = byId.get(el.materialId);
    if (!mat) continue;
    const m = elementMetrics(el, mat, cfg);
    const r = rows.get(mat.id) ?? { materialId: mat.id, name: mat.name, unit: mat.unit, count: 0, areaSf: 0, edgeLf: 0, surfaceCuYd: 0, baseCuYd: 0 };
    r.count++;
    r.areaSf += m.areaSf;
    r.edgeLf += m.edgeLf;
    r.surfaceCuYd += m.surfaceCuYd;
    r.baseCuYd += m.baseCuYd;
    rows.set(mat.id, r);
  }
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = list.reduce((a, r) => ({ count: a.count + r.count, areaSf: a.areaSf + r.areaSf, edgeLf: a.edgeLf + r.edgeLf, surfaceCuYd: a.surfaceCuYd + r.surfaceCuYd, baseCuYd: a.baseCuYd + r.baseCuYd }), { count: 0, areaSf: 0, edgeLf: 0, surfaceCuYd: 0, baseCuYd: 0 });
  return { rows: list, total };
}

export function takeoffCsv(rows: TakeoffRow[]): string {
  const head = ['Material', 'Count', 'Area (sq ft)', 'Edge (lin ft)', 'Surface (cu yd)', 'Base (cu yd)'];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [q(r.name), r.count, r.areaSf.toFixed(1), r.edgeLf.toFixed(1), r.surfaceCuYd.toFixed(2), r.baseCuYd.toFixed(2)].join(','));
  return [head.map(q).join(','), ...lines].join('\n');
}

export interface PermeabilityRow {
  id: string;
  name: string;
  /** Roofs, impermeable paving and walls, in sq ft */
  imperviousSf: number;
  /** Permeable paving, loose surfaces, beds, lawn */
  permeableSf: number;
  /** Bare ground not covered by any element or structure */
  openSoilSf: number;
  totalSf: number;
}

export interface CoverGrid {
  nx: number;
  ny: number;
  cell: number;
  /** 0 open soil, 1 permeable cover, 2 impervious cover (roofs, sealed paving) */
  cls: Uint8Array;
}

/** Rasterize what covers the lot: elements in draw order (topmost wins), then structures. */
export function buildCoverGrid(
  elements: HardscapeElement[],
  materials: Material[],
  structures: StructureCfg[],
  lot: { width: number; depth: number },
  cfg: HsCfg,
): CoverGrid {
  const cell = cfg.sampleCellFt;
  const nx = Math.ceil(lot.width / cell);
  const ny = Math.ceil(lot.depth / cell);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const cls = new Uint8Array(nx * ny);
  const paint = (poly: Pt[], value: number) => {
    if (poly.length < 3) return;
    const b = bbox(poly);
    const i0 = Math.max(0, Math.floor(b.minX / cell)), i1 = Math.min(nx - 1, Math.floor(b.maxX / cell));
    const j0 = Math.max(0, Math.floor(b.minY / cell)), j1 = Math.min(ny - 1, Math.floor(b.maxY / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPolygon((i + 0.5) * cell, (j + 0.5) * cell, poly)) cls[j * nx + i] = value;
      }
    }
  };
  const order = (e: HardscapeElement) => cfg.drawOrder.indexOf(e.type);
  const live = elements.filter((e) => !e.removed).sort((a, b) => order(a) - order(b));
  for (const el of live) {
    const mat = byId.get(el.materialId);
    if (!mat) continue;
    paint(footprint(el, cfg), mat.permeability >= cfg.permeableThreshold ? 1 : 2);
  }
  for (const s of structures) paint(s.footprint, 2);
  return { nx, ny, cell, cls };
}

/**
 * Permeable vs impervious area per yard zone and for the whole lot (HS-5). Samples the lot on a
 * grid. The element drawn on top wins, and structure footprints are impervious.
 */
export function permeabilityReport(
  elements: HardscapeElement[],
  materials: Material[],
  structures: StructureCfg[],
  zones: { id: string; name: string; polygon: Pt[] }[],
  lot: { width: number; depth: number },
  cfg: HsCfg,
): PermeabilityRow[] {
  const { nx, ny, cell, cls } = buildCoverGrid(elements, materials, structures, lot, cfg);
  const make = (id: string, name: string): PermeabilityRow => ({ id, name, imperviousSf: 0, permeableSf: 0, openSoilSf: 0, totalSf: 0 });
  const rows = zones.map((z) => make(z.id, z.name));
  const lotRow = make('lot', 'Whole lot');
  const cellArea = cell * cell;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      if (x > lot.width || y > lot.depth) continue;
      const c = cls[j * nx + i];
      const targets = [lotRow];
      const zi = zones.findIndex((z) => pointInPolygon(x, y, z.polygon));
      if (zi >= 0) targets.push(rows[zi]);
      for (const t of targets) {
        t.totalSf += cellArea;
        if (c === 2) t.imperviousSf += cellArea;
        else if (c === 1) t.permeableSf += cellArea;
        else t.openSoilSf += cellArea;
      }
    }
  }
  return [...rows, lotRow];
}

/** Convex shadow bodies for elements with height: wall and fence segments, deck and bed triangles. */
export function hardscapeSolids(elements: HardscapeElement[], cfg: HsCfg): Solid[] {
  const out: Solid[] = [];
  for (const el of elements) {
    if (el.removed || el.height <= 0) continue;
    const quad = (poly: Pt[], id: string) =>
      out.push({ id, density: 1, points: [...poly.map(([x, y]): Pt3 => [x, y, 0]), ...poly.map(([x, y]): Pt3 => [x, y, el.height])] });
    if (isLineElement(el, cfg)) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const seg = lineToPolygon([el.points[i], el.points[i + 1]], el.width);
        if (seg.length === 4) quad(seg, `${el.id}#${i}`);
      }
    } else {
      triangulate(el.points).forEach((tri, i) => quad(tri, `${el.id}#t${i}`));
    }
  }
  return out;
}

export type HardscapeWarning = { kind: 'easement' | 'tree-roots' | 'driveway' | 'outside-lot'; message: string };

export interface WarningContext {
  easements: { id: string; label: string; polygon: Pt[] }[];
  /** Existing trees whose root zone must stay clear, in feet. */
  trees: { id: string; name: string; x: number; y: number; canopyWidth: number }[];
  lot: { width: number; depth: number };
}

/** Warnings for new work: crossing an easement, covering an existing tree's root zone, blocking the driveway (HS-6). */
export function hardscapeWarnings(el: HardscapeElement, all: HardscapeElement[], ctx: WarningContext, cfg: HsCfg): HardscapeWarning[] {
  if (el.existing || el.removed) return [];
  const fp = footprint(el, cfg);
  const out: HardscapeWarning[] = [];
  for (const e of ctx.easements) {
    if (polygonsIntersect(fp, e.polygon)) out.push({ kind: 'easement', message: `Crosses the ${e.label}.` });
  }
  for (const t of ctx.trees) {
    if (circleOverlapsPolygon(t.x, t.y, (t.canopyWidth / 2) * cfg.rootZoneFactor, fp)) {
      out.push({ kind: 'tree-roots', message: `Covers the root zone of ${t.name}.` });
    }
  }
  for (const other of all) {
    if (other.keepClear && !other.removed && other.id !== el.id && polygonsIntersect(fp, footprint(other, cfg))) {
      out.push({ kind: 'driveway', message: `Blocks ${other.name ?? 'the driveway'}.` });
    }
  }
  const lotPoly: Pt[] = [[0, 0], [ctx.lot.width, 0], [ctx.lot.width, ctx.lot.depth], [0, ctx.lot.depth]];
  if (fp.some(([x, y]) => !pointInPolygon(x, y, lotPoly) && distanceToLot(x, y, ctx.lot) > 0.01)) {
    out.push({ kind: 'outside-lot', message: 'Extends outside the lot.' });
  }
  return out;
}

function distanceToLot(x: number, y: number, lot: { width: number; depth: number }): number {
  const dx = Math.max(0 - x, 0, x - lot.width);
  const dy = Math.max(0 - y, 0, y - lot.depth);
  return Math.hypot(dx, dy);
}

export interface SnapAnchor {
  points: Pt[];
  closed: boolean;
}

/** Edges and corners that drawing can snap to: the lot, structures, and other elements. */
export function snapAnchors(site: SiteConfig, structures: StructureCfg[], elements: HardscapeElement[], cfg: HsCfg, excludeId?: string): SnapAnchor[] {
  const { width, depth } = site.lot;
  const out: SnapAnchor[] = [{ points: [[0, 0], [width, 0], [width, depth], [0, depth]], closed: true }];
  for (const s of structures) out.push({ points: s.footprint, closed: true });
  for (const e of elements) {
    if (e.id === excludeId || e.removed) continue;
    out.push({ points: e.points, closed: !isLineElement(e, cfg) });
  }
  return out;
}

export interface SnapResult {
  point: Pt;
  kind: 'vertex' | 'edge' | 'grid';
}

/** Snap to a nearby corner first, then a nearby edge, otherwise the grid (HS-7). */
export function snapPoint(p: Pt, grid: number, anchors: SnapAnchor[], tolerance: number): SnapResult {
  let bestV: { d: number; pt: Pt } | null = null;
  let bestE: { d: number; pt: Pt } | null = null;
  for (const a of anchors) {
    for (const v of a.points) {
      const d = Math.hypot(p[0] - v[0], p[1] - v[1]);
      if (d <= tolerance && (!bestV || d < bestV.d)) bestV = { d, pt: v };
    }
    const n = a.points.length;
    for (let i = 0; i < (a.closed ? n : n - 1); i++) {
      const { dist, point } = distanceToSegment(p, a.points[i], a.points[(i + 1) % n]);
      if (dist <= tolerance && (!bestE || dist < bestE.d)) bestE = { d: dist, pt: point };
    }
  }
  if (bestV) return { point: [bestV.pt[0], bestV.pt[1]], kind: 'vertex' };
  if (bestE) return { point: bestE.pt, kind: 'edge' };
  return { point: [Math.round(p[0] / grid) * grid, Math.round(p[1] / grid) * grid], kind: 'grid' };
}
