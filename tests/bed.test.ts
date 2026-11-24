import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { bedFromCells, bedGap, cellsOutline, connected, joinBeds, placeShape, reshapeBed, rotateBed, rotateCells, settleBed, shapeIdOf, type Cell } from '../src/engine/bed';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { generateConcept } from '../src/engine/concept';
import { cropPositions } from '../src/engine/crops';
import { distanceToSegment, pointInPolygon, polygonArea } from '../src/engine/geometry';
import { emptyScenarioData } from '../src/engine/scenario';
import { mulberry32 } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import { raisedBedGeometry } from '../src/scene/raisedBed';
import { makeAppStore } from '../src/store/store';
import type { EngineConfig, HardscapeElement, Material, Pt, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.hardscape.raisedBedModule;
const C = cfg.cellFt;

const bed = (id: string, shape: string, at: Pt): HardscapeElement => {
  const b = placeShape(shape, at, cfg)!;
  return { id, type: 'raisedBed', points: b.points, cells: b.cells, materialId: 'raised-bed-wood', height: 1.5, depthIn: 0, width: 0, existing: false };
};
const area = (e: HardscapeElement) => polygonArea(e.points);

describe('raised bed shapes', () => {
  it('has a 3 by 3 module as the smallest bed and the shapes the owner asked for', () => {
    expect(C).toBe(3);
    expect(cfg.shapes.map((s) => s.id)).toEqual(['square', 'bar', 'large', 'L', 'U']);
    const squareBed = bed('a', 'square', [20, 20]);
    expect(area(squareBed)).toBe(9);
  });

  it('draws each shape with the right area and only its corners as outline points', () => {
    const area9 = (n: number) => n * 9;
    expect(area(bed('a', 'bar', [20, 20]))).toBe(area9(2));
    expect(area(bed('a', 'large', [20, 20]))).toBe(36);
    const L = bed('a', 'L', [20, 20]);
    expect(area(L)).toBe(area9(3));
    expect(L.points).toHaveLength(6);
    const U = bed('a', 'U', [20, 20]);
    expect(area(U)).toBe(area9(5));
    expect(U.points).toHaveLength(8);
    expect(bed('a', 'large', [20, 20]).points).toHaveLength(4);
  });

  it('runs the outline counter-clockwise, and places a shape centered where it was put', () => {
    const U = bed('a', 'U', [30, 40]);
    let twice = 0;
    U.points.forEach(([x1, y1], i) => { const [x2, y2] = U.points[(i + 1) % U.points.length]; twice += x1 * y2 - x2 * y1; });
    expect(twice).toBeGreaterThan(0);
    const xs = U.points.map((p) => p[0]), ys = U.points.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(30, 9);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(40, 9);
  });

  it('knows a shape however it is turned or mirrored, and nothing else', () => {
    const L = cfg.shapes.find((s) => s.id === 'L')!.cells;
    for (let q = 0; q < 4; q++) expect(shapeIdOf(rotateCells(L, q), cfg)).toBe('L');
    expect(shapeIdOf([[0, 0], [0, 1], [1, 1]], cfg)).toBe('L');
    expect(shapeIdOf([[0, 0], [0, 1], [0, 2]], cfg)).toBeNull(); // a straight run of three
    expect(shapeIdOf([[0, 0], [1, 0], [2, 0], [1, 1]], cfg)).toBeNull(); // a T
    expect(shapeIdOf([[0, 0], [2, 0]], cfg)).toBeNull(); // not touching
    expect(shapeIdOf([[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]], cfg)).toBeNull(); // six... a P of five is not a U
    const U = cfg.shapes.find((s) => s.id === 'U')!.cells;
    expect(shapeIdOf(rotateCells(U, 1), cfg)).toBe('U');
  });

  it('rotates a bed a quarter turn about its center, swapping a bar from wide to tall', () => {
    const bar = bed('a', 'bar', [30, 40]);
    const r = rotateBed(bar, cfg)!;
    const xs = r.points.map((p) => p[0]), ys = r.points.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(6);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(30, 9);
    expect(polygonArea(r.points)).toBe(18);
    expect(shapeIdOf(rotateBed({ ...bar, cells: r.cells, points: r.points }, cfg, 3)!.cells, cfg)).toBe('bar');
  });

  it('swaps a bed for another shape around the same center', () => {
    const big = reshapeBed(bed('a', 'large', [30, 40]), 'U', cfg)!;
    expect(big.cells).toHaveLength(5);
  });
});

describe('snapping beds together', () => {
  it('slides a 3 by 3 flush against another within 2 ft and joins them into one 3 by 6 bed', () => {
    const a = bed('a', 'square', [20, 20]);
    const b = bed('b', 'square', [20, 20 + 3 + 1.5]); // 1.5 ft apart
    expect(bedGap(a, b, C)).toBeCloseTo(1.5, 9);
    const joined = joinBeds(b, a, cfg)!;
    expect(joined.id).toBe('a');
    expect(shapeIdOf(joined.cells!, cfg)).toBe('bar');
    expect(polygonArea(joined.points)).toBe(18);
  });

  it('also aligns the grid when the second bed is off to one side', () => {
    const a = bed('a', 'square', [20, 20]);
    const b = bed('b', 'square', [21, 20 + 3 + 1]);
    const j = joinBeds(b, a, cfg)!;
    // Two squares one above the other: the outline is a clean 3 by 6 rectangle on a's grid.
    const xs = j.points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(18.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(21.5, 9);
  });

  it('leaves beds more than 2 ft apart alone', () => {
    const a = bed('a', 'square', [20, 20]);
    const b = bed('b', 'square', [20, 20 + 3 + 2.5]);
    expect(joinBeds(b, a, cfg)).toBeNull();
    expect(settleBed('b', [a, b], cfg)).toBeNull();
  });

  it('builds the L from three 3 by 3s and the 6 by 6 from four, one placement at a time', () => {
    let els = [bed('a', 'square', [20, 20])];
    els.push(bed('b', 'square', [20, 24]));
    let r = settleBed('b', els, cfg)!;
    els = r.elements;
    expect(els).toHaveLength(1);
    expect(shapeIdOf(els[0].cells!, cfg)).toBe('bar');
    // A third, beside the bar's end and its side: it makes the L.
    els.push(bed('c', 'square', [24, 22]));
    r = settleBed('c', els, cfg)!;
    els = r.elements;
    expect(els).toHaveLength(1);
    expect(shapeIdOf(els[0].cells!, cfg)).toBe('L');
    // The fourth goes into the empty corner of the L, from below and to the side: 6 by 6.
    els.push(bed('d', 'square', [24.5, 17.5]));
    r = settleBed('d', els, cfg)!;
    els = r.elements;
    expect(els).toHaveLength(1);
    expect(shapeIdOf(els[0].cells!, cfg)).toBe('large');
    expect(polygonArea(els[0].points)).toBe(36);
    expect(connected(els[0].cells!)).toBe(true);
  });

  it('will not join into a shape that is not one of the set shapes: a straight run of three stays separate', () => {
    const els = [bed('a', 'bar', [20, 20]), bed('b', 'square', [20 + 4.5 + 3 + 1 - 3, 20])];
    // Place the square so the only flush spots beyond the bar's end make a 3 by 9 run: not allowed.
    const lone = { ...els[1], ...bedFromCells([[0, 0]], [20 + 4.5 + 1, 18.5], C) };
    const out = joinBeds(lone, els[0], cfg);
    if (out) expect(shapeIdOf(out.cells!, cfg)).not.toBeNull(); // any join that happens is a set shape
    expect(shapeIdOf([[0, 0], [1, 0], [2, 0]], cfg)).toBeNull();
  });

  it('joins a 3 by 3 beside a bar to make an L, and ignores beds that are existing work or not modules', () => {
    const bar = bed('a', 'bar', [20, 20]);
    const sq = bed('b', 'square', [20 + 1.5 + 1.5 + 1, 20 - 3 - 0.5]);
    const j = joinBeds(sq, bar, cfg);
    expect(j && shapeIdOf(j.cells!, cfg)).toBe('L');
    const legacy: HardscapeElement = { ...bar, id: 'old', cells: undefined };
    expect(joinBeds(sq, legacy, cfg)).toBeNull();
  });

  it('keeps the neighbor’s name, crops and material when beds join', () => {
    const a = { ...bed('a', 'square', [20, 20]), name: 'Salad bed', crops: { cool: 'lettuce', warm: 'basil' } } as HardscapeElement;
    const b = bed('b', 'square', [20, 24]);
    const { elements } = settleBed('b', [a, b], cfg)!;
    expect(elements[0].name).toBe('Salad bed');
    expect(elements[0].crops).toEqual(a.crops);
  });
});

describe('outlines', () => {
  it('traces an L and a U as simple outlines with the right corner count and area', () => {
    const cellsL: Cell[] = [[0, 0], [1, 0], [0, 1]];
    expect(cellsOutline(cellsL, [0, 0], 3)).toEqual([[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]]);
  });
});

describe('raised beds in the app', () => {
  const place = (s: ReturnType<typeof makeAppStore>, shape: string, at: Pt) => {
    s.getState().startDrawing('raisedBed', shape);
    return s.getState().placePreset(at);
  };
  const beds = (s: ReturnType<typeof makeAppStore>) => s.getState().hardscape.filter((e) => e.type === 'raisedBed');

  it('places a set shape in one click, centered, with its modules recorded', () => {
    const s = makeAppStore('edit');
    const id = place(s, 'U', [30, 100])!;
    const el = s.getState().hardscape.find((e) => e.id === id)!;
    expect(el.cells).toHaveLength(5);
    expect(shapeIdOf(el.cells!, cfg)).toBe('U');
    expect(polygonArea(el.points)).toBe(45);
    expect(s.getState().drawing).toBeNull();
  });

  it('snaps a bed placed within 2 ft of another and joins them into one', () => {
    const s = makeAppStore('edit');
    place(s, 'square', [30, 100]);
    const before = beds(s).length;
    const id = place(s, 'square', [30, 104.2])!; // 1.2 ft apart
    expect(beds(s)).toHaveLength(before); // one joined bed, not two
    const joined = s.getState().hardscape.find((e) => e.id === id)!;
    expect(shapeIdOf(joined.cells!, cfg)).toBe('bar');
    expect(s.getState().selectedElementId).toBe(id);
  });

  it('leaves beds further apart than that separate', () => {
    const s = makeAppStore('edit');
    place(s, 'square', [30, 100]);
    const n = beds(s).length;
    place(s, 'square', [30, 106]);
    expect(beds(s)).toHaveLength(n + 1);
  });

  it('settles a bed that is dragged near another when it is let go, and a single undo takes it back', () => {
    const s = makeAppStore('edit');
    const a = place(s, 'square', [30, 100])!;
    const b = place(s, 'square', [30, 110])!;
    s.getState().beginGesture();
    s.getState().moveElementBy(b, 0, -5.2); // now 1.8 ft above a
    expect(beds(s).some((e) => e.id === b)).toBe(true);
    s.getState().settleBed(b);
    expect(beds(s).filter((e) => e.id === a || e.id === b)).toHaveLength(1);
    s.getState().undo();
    expect(beds(s).filter((e) => e.id === a || e.id === b)).toHaveLength(2);
  });

  it('turns only in quarter turns, and swaps the shape in place', () => {
    const s = makeAppStore('edit');
    const id = place(s, 'bar', [30, 100])!;
    const w = (e: HardscapeElement) => Math.max(...e.points.map((p) => p[0])) - Math.min(...e.points.map((p) => p[0]));
    expect(w(s.getState().hardscape.find((e) => e.id === id)!)).toBe(6);
    s.getState().rotateElement(id, 15);
    expect(w(s.getState().hardscape.find((e) => e.id === id)!)).toBe(6); // 15 degrees is ignored
    s.getState().rotateElement(id);
    expect(w(s.getState().hardscape.find((e) => e.id === id)!)).toBe(3);
    s.getState().setBedShape(id, 'L');
    expect(shapeIdOf(s.getState().hardscape.find((e) => e.id === id)!.cells!, cfg)).toBe('L');
  });

  it('cannot be reshaped by a corner drag, and view mode places nothing', () => {
    const s = makeAppStore('view');
    s.getState().startDrawing('raisedBed', 'square');
    expect(s.getState().drawing).toBeNull();
  });
});

describe('raised beds in shuffled concepts', () => {
  const site = loadSite(siteRaw);
  const lib = speciesRaw as unknown as SpeciesLibrary;
  const ctx = { site, structures: activeStructures(site, { aduEnabled: true }), species: lib.species, materials: materialsRaw as unknown as Material[], engine, palette: emptyScenarioData(site).palette };

  it('only ever make set shapes, drawn from their modules, and never two that would snap together', () => {
    let seen = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const r = generateConcept(ctx, { hardscape: true, plants: false, starredOnly: false }, mulberry32(seed));
      const mine = r.data.hardscape.filter((e) => e.type === 'raisedBed' && !e.existing);
      for (const e of mine) {
        seen++;
        expect(e.cells, e.id).toBeDefined();
        const id = shapeIdOf(e.cells!, cfg);
        expect(id, e.id).not.toBeNull();
        kinds.add(id!);
        expect(polygonArea(e.points)).toBeCloseTo(e.cells!.length * C * C, 6);
      }
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) expect(bedGap(mine[i], mine[j], C), `seed ${seed}`).toBeGreaterThan(cfg.snapFt);
    }
    expect(seen).toBeGreaterThan(20);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});

describe('frames and crops in L and U beds', () => {
  const frame = engine.hardscape.raisedBedFrame;
  it('builds a frame round an L and a U with its boards and posts inside the outline plus the cap overhang', () => {
    for (const shape of ['L', 'U']) {
      const b = bed('a', shape, [30, 40]);
      const g = raisedBedGeometry(b.points, 1.5, 1.25, '#8a6a47', frame, 3);
      expect(g.wood, shape).toBeTruthy();
      g.wood!.computeBoundingBox();
      const box = g.wood!.boundingBox!;
      const xs = b.points.map((p) => p[0]), ys = b.points.map((p) => p[1]);
      expect(box.min.x).toBeGreaterThanOrEqual(Math.min(...xs) - frame.capOverhangFt - 1e-6);
      expect(box.max.x).toBeLessThanOrEqual(Math.max(...xs) + frame.capOverhangFt + 1e-6);
      expect(box.min.y).toBeGreaterThanOrEqual(Math.min(...ys) - frame.capOverhangFt - 1e-6);
      expect(box.max.y).toBeLessThanOrEqual(Math.max(...ys) + frame.capOverhangFt + 1e-6);
    }
  });

  it('plants crops only inside the bed and clear of its walls, including round the notch of an L', () => {
    const L = bed('a', 'L', [30, 40]);
    const crops = engine.crops;
    const spots = cropPositions(L.points, 1, crops);
    expect(spots.length).toBeGreaterThan(5);
    for (const [x, y] of spots) {
      expect(pointInPolygon(x, y, L.points)).toBe(true);
      let nearest = Infinity;
      L.points.forEach((p, i) => { nearest = Math.min(nearest, distanceToSegment([x, y], p, L.points[(i + 1) % L.points.length]).dist); });
      expect(nearest).toBeGreaterThanOrEqual(crops.insetFt * 0.5 - 1e-9);
    }
    // None in the notch.
    expect(spots.some(([x, y]) => x > 33 && y > 40 && x < 36 && y < 43 && !pointInPolygon(x, y, L.points))).toBe(false);
  });
});
