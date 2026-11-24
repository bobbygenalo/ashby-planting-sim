import type { HardscapeElement, Pt, RaisedBedModuleCfg } from './types';

/**
 * Raised beds built from square modules: a few set shapes (a 3 by 3 square, a 3 by 6 bar, a 6 by 6 square, an L and a U)
 * that snap together when modules are placed near each other. Pure functions, no React or three.js.
 */
export type Cell = [number, number];

const key = (c: Cell[]) => c.map(([i, j]) => `${i},${j}`).join(';');

/** Shift the modules so the lowest column and row are 0, sorted. */
export function normalizeCells(cells: Cell[]): Cell[] {
  const i0 = Math.min(...cells.map((c) => c[0])), j0 = Math.min(...cells.map((c) => c[1]));
  return cells.map(([i, j]): Cell => [i - i0, j - j0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Turn the modules a quarter turn clockwise (seen from above, with +Y up the page). */
export function rotateCells(cells: Cell[], quarters = 1): Cell[] {
  let out = cells;
  for (let q = 0; q < ((quarters % 4) + 4) % 4; q++) out = out.map(([i, j]): Cell => [j, -i]);
  return normalizeCells(out);
}

/** The eight turns and mirror images of a set of modules. */
function symmetries(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  for (const mirror of [false, true]) {
    const base = mirror ? cells.map(([i, j]): Cell => [-i, j]) : cells;
    for (let q = 0; q < 4; q++) out.push(rotateCells(base, q));
  }
  return out;
}

const canonical = (cells: Cell[]) => symmetries(cells).map(key).sort()[0];

/** The id of the shape a set of modules makes, or null when it is none of the set shapes (or not one connected piece). */
export function shapeIdOf(cells: Cell[], cfg: RaisedBedModuleCfg): string | null {
  if (cells.length === 0 || !connected(cells)) return null;
  const k = canonical(cells);
  return cfg.shapes.find((s) => canonical(s.cells) === k)?.id ?? null;
}

/** Whether every module touches the rest by an edge. */
export function connected(cells: Cell[]): boolean {
  const seen = new Set<string>([key([cells[0]])]);
  const todo: Cell[] = [cells[0]];
  const has = new Set(cells.map((c) => key([c])));
  while (todo.length) {
    const [i, j] = todo.pop()!;
    for (const n of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as Cell[]) {
      const k = key([n]);
      if (has.has(k) && !seen.has(k)) { seen.add(k); todo.push(n); }
    }
  }
  return seen.size === cells.length;
}

/** The outline of connected modules, counter-clockwise, with only the corners as vertices. Handles any shape without holes. */
export function cellsOutline(cells: Cell[], origin: Pt, cellFt: number): Pt[] {
  const has = new Set(cells.map((c) => key([c])));
  const solid = (i: number, j: number) => has.has(`${i},${j}`);
  // Directed edges with the module on their left, so the outline runs counter-clockwise.
  const next = new Map<string, Cell>();
  for (const [i, j] of cells) {
    if (!solid(i, j - 1)) next.set(`${i},${j}`, [i + 1, j]);
    if (!solid(i + 1, j)) next.set(`${i + 1},${j}`, [i + 1, j + 1]);
    if (!solid(i, j + 1)) next.set(`${i + 1},${j + 1}`, [i, j + 1]);
    if (!solid(i - 1, j)) next.set(`${i},${j + 1}`, [i, j]);
  }
  const start = [...next.keys()][0];
  const ring: Cell[] = [];
  let cur = start;
  do {
    const [x, y] = cur.split(',').map(Number) as Cell;
    ring.push([x, y]);
    cur = key([next.get(cur)!]);
  } while (cur !== start && ring.length < next.size + 2);
  // Drop the points that lie on a straight run.
  const corners = ring.filter((p, n) => {
    const a = ring[(n + ring.length - 1) % ring.length], b = ring[(n + 1) % ring.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  return corners.map(([x, y]): Pt => [origin[0] + x * cellFt, origin[1] + y * cellFt]);
}

/** The lower-left corner of a bed's bounding box. */
export const bedOrigin = (el: { points: Pt[] }): Pt => [Math.min(...el.points.map((p) => p[0])), Math.min(...el.points.map((p) => p[1]))];

export const bedSize = (cells: Cell[]): [number, number] => [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];

/** A bed's modules, set on the grid at an origin. */
export function bedFromCells(cells: Cell[], origin: Pt, cellFt: number): { cells: Cell[]; points: Pt[] } {
  const norm = normalizeCells(cells);
  return { cells: norm, points: cellsOutline(norm, origin, cellFt) };
}

/** A set shape centered on a point, as the cells and outline of a new bed. */
export function placeShape(shapeId: string, center: Pt, cfg: RaisedBedModuleCfg): { cells: Cell[]; points: Pt[] } | null {
  const shape = cfg.shapes.find((s) => s.id === shapeId);
  if (!shape) return null;
  const [w, h] = bedSize(shape.cells);
  return bedFromCells(shape.cells, [center[0] - (w * cfg.cellFt) / 2, center[1] - (h * cfg.cellFt) / 2], cfg.cellFt);
}

/** Turn a module bed a quarter turn about the center of its bounding box. */
export function rotateBed(el: HardscapeElement, cfg: RaisedBedModuleCfg, quarters = 1): { cells: Cell[]; points: Pt[] } | null {
  if (!el.cells) return null;
  const o = bedOrigin(el);
  const [w, h] = bedSize(el.cells);
  const center: Pt = [o[0] + (w * cfg.cellFt) / 2, o[1] + (h * cfg.cellFt) / 2];
  const cells = rotateCells(el.cells, quarters);
  const [w2, h2] = bedSize(cells);
  return bedFromCells(cells, [center[0] - (w2 * cfg.cellFt) / 2, center[1] - (h2 * cfg.cellFt) / 2], cfg.cellFt);
}

/** Replace a bed's shape with another, keeping the center of its bounding box. */
export function reshapeBed(el: HardscapeElement, shapeId: string, cfg: RaisedBedModuleCfg): { cells: Cell[]; points: Pt[] } | null {
  const xs = el.points.map((p) => p[0]), ys = el.points.map((p) => p[1]);
  return placeShape(shapeId, [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], cfg);
}

/** The squares a module bed covers, in site feet. */
export function bedSquares(el: HardscapeElement, cellFt: number): { x: number; y: number }[] {
  const o = bedOrigin(el);
  return (el.cells ?? []).map(([i, j]) => ({ x: o[0] + i * cellFt, y: o[1] + j * cellFt }));
}

/** The shortest distance between the edges of two beds (0 when they touch or overlap). */
export function bedGap(a: HardscapeElement, b: HardscapeElement, cellFt: number): number {
  let best = Infinity;
  for (const p of bedSquares(a, cellFt)) for (const q of bedSquares(b, cellFt)) {
    const dx = Math.max(0, Math.abs(p.x - q.x) - cellFt), dy = Math.max(0, Math.abs(p.y - q.y) - cellFt);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/**
 * Join a bed to a neighbor within `snapFt`: slide it flush against the neighbor, on the neighbor's grid, in the closest
 * place where the two together make one of the set shapes. Returns the joined bed (the neighbor, grown), or null when
 * they are too far apart or no place makes a set shape.
 */
export function joinBeds(moving: HardscapeElement, neighbor: HardscapeElement, cfg: RaisedBedModuleCfg): HardscapeElement | null {
  if (!moving.cells || !neighbor.cells) return null;
  const c = cfg.cellFt;
  if (bedGap(moving, neighbor, c) > cfg.snapFt + 1e-6) return null;
  const om = bedOrigin(moving), on = bedOrigin(neighbor);
  const reach = cfg.snapFt + c / 2 + 1e-6;
  const nSet = new Set(neighbor.cells.map((q) => key([q])));
  // Grid-aligned slides: the moving bed's origin lands on the neighbor's grid.
  const baseI = Math.round((om[0] - on[0]) / c), baseJ = Math.round((om[1] - on[1]) / c);
  let best: { cells: Cell[]; move: number } | null = null;
  for (let di = baseI - 3; di <= baseI + 3; di++) {
    for (let dj = baseJ - 3; dj <= baseJ + 3; dj++) {
      const mx = on[0] + di * c - om[0], my = on[1] + dj * c - om[1];
      if (Math.abs(mx) > reach || Math.abs(my) > reach) continue;
      const shifted = moving.cells.map(([i, j]): Cell => [i + di, j + dj]);
      if (shifted.some((q) => nSet.has(key([q])))) continue; // overlapping
      const all = [...neighbor.cells, ...shifted];
      if (!connected(all) || !shapeIdOf(all, cfg)) continue;
      const move = Math.hypot(mx, my);
      if (!best || move < best.move) best = { cells: all, move };
    }
  }
  if (!best) return null;
  const lowI = Math.min(...best.cells.map((q) => q[0])), lowJ = Math.min(...best.cells.map((q) => q[1]));
  const joined = bedFromCells(best.cells, [on[0] + lowI * c, on[1] + lowJ * c], c);
  return { ...neighbor, cells: joined.cells, points: joined.points };
}

/**
 * Settle one bed against the others after it is placed or moved: join it to the closest neighbor it can make a set shape
 * with, and keep going, since the joined bed may now be near another. Returns the new list of elements, or null when
 * nothing joined.
 */
export function settleBed(id: string, elements: HardscapeElement[], cfg: RaisedBedModuleCfg): { elements: HardscapeElement[]; id: string } | null {
  let list = elements;
  let cur: HardscapeElement | undefined = list.find((e) => e.id === id);
  if (!cur?.cells || cur.removed || cur.existing) return null;
  let joinedAny = false;
  for (let guard = 0; guard < 8; guard++) {
    const me: HardscapeElement | undefined = cur;
    if (!me) break;
    const others = list
      .filter((e) => e.id !== me.id && e.type === 'raisedBed' && e.cells && !e.removed && !e.existing)
      .map((e) => ({ e, gap: bedGap(me, e, cfg.cellFt) }))
      .filter((o) => o.gap <= cfg.snapFt + 1e-6)
      .sort((a, b) => a.gap - b.gap);
    let merged: { into: HardscapeElement; result: HardscapeElement } | null = null;
    for (const { e } of others) {
      const result = joinBeds(me, e, cfg);
      if (result) { merged = { into: e, result }; break; }
    }
    if (!merged) break;
    list = list.filter((e) => e.id !== me.id).map((e) => (e.id === merged!.into.id ? merged!.result : e));
    cur = merged.result;
    joinedAny = true;
  }
  return joinedAny && cur ? { elements: list, id: cur.id } : null;
}
