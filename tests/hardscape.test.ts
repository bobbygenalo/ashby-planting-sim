import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import { circleOverlapsPolygon, isConvex, lineToPolygon, polygonArea, polygonsIntersect, triangulate } from '../src/engine/geometry';
import {
  elementMetrics, hardscapeSolids, hardscapeWarnings, permeabilityReport, snapAnchors, snapPoint, takeoff, takeoffCsv,
} from '../src/engine/hardscape';
import { buildSunScene, loadSite } from '../src/engine/site';
import { computeSunHours } from '../src/engine/sunhours';
import type { EngineConfig, HardscapeElement, Material, Pt } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const cfg = engine.hardscape;
const site = loadSite(siteRaw);
const mat = (id: string) => mats.find((m) => m.id === id)!;

const rect = (x: number, y: number, w: number, d: number): Pt[] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
let n = 0;
const el = (over: Partial<HardscapeElement>): HardscapeElement => ({
  id: `e${n++}`, type: 'patio', points: rect(20, 90, 10, 12), materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false, ...over,
});

describe('M4 acceptance: patio quantities', () => {
  it('a 10 ft by 12 ft patio at 4 in reports 120 sq ft and about 1.5 cu yd', () => {
    const patio = el({});
    const m = elementMetrics(patio, mat('concrete'), cfg);
    expect(m.areaSf).toBeCloseTo(120, 6);
    expect(m.edgeLf).toBeCloseTo(44, 6);
    expect(m.surfaceCuYd).toBeCloseTo(1.4815, 3);
    expect(m.surfaceCuYd).toBeGreaterThan(1.4);
    expect(m.surfaceCuYd).toBeLessThan(1.6);
    expect(m.baseCuYd).toBeCloseTo(1.4815, 3); // concrete base is also 4 in
  });
});

describe('geometry', () => {
  it('thickens a straight polyline into a rectangle of length x width', () => {
    const poly = lineToPolygon([[0, 0], [20, 0]], 3);
    expect(polygonArea(poly)).toBeCloseTo(60, 6);
  });
  it('keeps a mitered L-shaped path near length x width', () => {
    const poly = lineToPolygon([[0, 0], [10, 0], [10, 10]], 2);
    expect(polygonArea(poly)).toBeGreaterThan(38);
    expect(polygonArea(poly)).toBeLessThan(42);
  });
  it('triangulates concave polygons without losing area', () => {
    const L: Pt[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    expect(isConvex(L)).toBe(false);
    const tris = triangulate(L);
    expect(tris.length).toBe(4);
    expect(tris.reduce((a, t) => a + polygonArea(t), 0)).toBeCloseTo(polygonArea(L), 6);
    expect(isConvex(rect(0, 0, 3, 3))).toBe(true);
  });
  it('detects overlaps, containment and circle contact', () => {
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(2, 2, 3, 3))).toBe(true);
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(20, 20, 3, 3))).toBe(false);
    expect(circleOverlapsPolygon(12, 5, 3, rect(0, 0, 10, 10))).toBe(true);
    expect(circleOverlapsPolygon(20, 5, 3, rect(0, 0, 10, 10))).toBe(false);
  });
});

describe('takeoff (HS-4)', () => {
  it('sums by material for new work only', () => {
    const els = [
      el({}),
      el({ points: rect(30, 90, 5, 5) }),
      el({ type: 'path', materialId: 'decomposed-granite', points: [[0, 0], [20, 0]], width: 3, depthIn: 3 }),
      el({ type: 'wall', materialId: 'cmu-wall', points: [[0, 0], [10, 0]], width: 0.67, height: 3, depthIn: 0 }),
      el({ existing: true }),
      el({ removed: true }),
    ];
    const t = takeoff(els, mats, cfg);
    const concrete = t.rows.find((r) => r.materialId === 'concrete')!;
    expect(concrete.count).toBe(2);
    expect(concrete.areaSf).toBeCloseTo(145, 6);
    const dg = t.rows.find((r) => r.materialId === 'decomposed-granite')!;
    expect(dg.areaSf).toBeCloseTo(60, 6);
    expect(dg.edgeLf).toBeCloseTo(20, 6);
    expect(dg.surfaceCuYd).toBeCloseTo((60 * (3 / 12)) / 27, 6);
    const wall = t.rows.find((r) => r.materialId === 'cmu-wall')!;
    expect(wall.unit).toBe('lf');
    expect(wall.baseCuYd).toBeCloseTo((10 * 0.67 * 1) / 27, 6); // 12 in footing
    expect(wall.surfaceCuYd).toBe(0);
    expect(t.total.count).toBe(4);
  });
  it('writes a CSV with a header row', () => {
    const csv = takeoffCsv(takeoff([el({})], mats, cfg).rows);
    expect(csv.split('\n')[0]).toContain('Material');
    expect(csv.split('\n')[1]).toContain('Concrete slab');
    expect(csv).toContain('120.0');
  });
});

describe('permeable vs impervious (HS-5)', () => {
  const structures = site.structures;
  const rows = (els: HardscapeElement[]) => permeabilityReport(els, mats, structures, site.zones, site.lot, cfg);
  const back = (r: ReturnType<typeof rows>) => r.find((x) => x.id === 'back_yard')!;

  it('counts a concrete patio as impervious and a decomposed granite patio as permeable', () => {
    const base = back(rows([]));
    const withConcrete = back(rows([el({ points: rect(30, 70, 10, 12) })]));
    expect(withConcrete.imperviousSf - base.imperviousSf).toBeCloseTo(120, 0);
    expect(base.openSoilSf - withConcrete.openSoilSf).toBeCloseTo(120, 0);
    const withDg = back(rows([el({ points: rect(30, 70, 10, 12), materialId: 'decomposed-granite' })]));
    expect(withDg.permeableSf).toBeCloseTo(base.permeableSf + 120, 0);
    expect(withDg.imperviousSf).toBeCloseTo(base.imperviousSf, 0);
  });
  it('lot totals equal the lot area and include structures as impervious', () => {
    const all = rows([]);
    const lot = all.find((r) => r.id === 'lot')!;
    // Sampled on a 0.5 ft grid, so the total is within half a percent of the true lot area.
    expect(Math.abs(lot.totalSf / (site.lot.width * site.lot.depth) - 1)).toBeLessThan(0.005);
    // With no paving drawn, the impervious area is the roofs: the sum of every structure footprint, sampled on a 0.5 ft grid.
    const footprints = structures.reduce((a, s) => a + polygonArea(s.footprint), 0);
    expect(Math.abs(lot.imperviousSf / footprints - 1)).toBeLessThan(0.015);
  });
  it('removed existing hardscape no longer counts, and the top element wins where they overlap', () => {
    const drive = site.hardscape[0];
    const keep = rows([drive]).find((r) => r.id === 'lot')!;
    const gone = rows([{ ...drive, removed: true }]).find((r) => r.id === 'lot')!;
    // The driveway from the garage plan: a narrow run, a taper, and a 16 ft apron.
    expect(Math.abs((keep.imperviousSf - gone.imperviousSf) / polygonArea(drive.points) - 1)).toBeLessThan(0.02); // sampled on a grid
    expect(polygonArea(drive.points)).toBeGreaterThan(700);
    // A patio sits above gravel in the draw order, so where they overlap the area counts as impervious.
    const empty = back(rows([]));
    const overlap = back(rows([el({ points: rect(30, 70, 10, 10) }), el({ type: 'gravel', materialId: 'gravel', points: rect(30, 70, 10, 10) })]));
    expect(overlap.imperviousSf - empty.imperviousSf).toBeCloseTo(100, 0);
    expect(overlap.permeableSf).toBeCloseTo(empty.permeableSf, 0);
  });
});

describe('warnings (HS-6)', () => {
  const ctx = {
    easements: site.easements.map((e) => ({ id: e.id, label: e.label, polygon: e.polygon })),
    trees: site.contextObjects.filter((o) => o.kind === 'tree').map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], canopyWidth: o.canopyWidth ?? 10 })),
    lot: site.lot,
  };
  const warn = (e: HardscapeElement) => hardscapeWarnings(e, [...site.hardscape, e], ctx, cfg).map((w) => w.kind);
  it('flags easement, tree roots, driveway and outside-lot', () => {
    expect(warn(el({ points: rect(2, 144, 6, 5) }))).toContain('easement');
    expect(warn(el({ points: rect(2, 120, 4, 4) }))).toContain('tree-roots');
    expect(warn(el({ points: rect(5, 40, 6, 6) }))).toContain('driveway');
    expect(warn(el({ points: rect(48, 40, 6, 6) }))).toContain('outside-lot');
  });
  it('is quiet for clear ground and for existing elements', () => {
    expect(warn(el({ points: rect(30, 80, 6, 6) }))).toEqual([]);
    expect(warn(el({ points: rect(5, 40, 6, 6), existing: true }))).toEqual([]);
  });
});

describe('snapping (HS-7)', () => {
  const anchors = snapAnchors(site, site.structures, [], cfg);
  it('prefers a corner, then an edge, then the grid', () => {
    const house = site.structures.find((s) => s.id === 'house-main')!;
    const corner = house.footprint[0];
    expect(snapPoint([corner[0] + 0.4, corner[1] - 0.3], 0.5, anchors, 1)).toMatchObject({ kind: 'vertex', point: corner });
    const frontY = site.structures.find((s) => s.id === 'house-porch')!.footprint[0][1]; // the house's front wall
    const e = snapPoint([20, frontY + 0.6], 0.5, anchors, 1);
    expect(e.kind).toBe('edge');
    expect(e.point[1]).toBeCloseTo(frontY, 6);
    expect(e.point[0]).toBeCloseTo(20, 6);
    expect(snapPoint([30.27, 100.8], 0.5, anchors, 0.3)).toEqual({ kind: 'grid', point: [30.5, 101] });
  });
});

describe('shade from hardscape (HS-3)', () => {
  it('walls and decks become shadow solids, flat paving does not', () => {
    const wall = el({ type: 'wall', materialId: 'cmu-wall', points: [[10, 60], [10, 70], [20, 70]], width: 0.67, height: 3, depthIn: 0 });
    const deck = el({ type: 'deck', materialId: 'wood-deck', points: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], height: 1.5 });
    expect(hardscapeSolids([wall], cfg).length).toBe(2);
    expect(hardscapeSolids([deck], cfg).length).toBe(4);
    expect(hardscapeSolids([el({})], cfg).length).toBe(0);
    expect(hardscapeSolids([{ ...wall, removed: true }], cfg).length).toBe(0);
  });
  it('a tall wall shades the ground behind it in winter', () => {
    const wall = el({ type: 'wall', materialId: 'cmu-wall', points: [[20, 95], [45, 95]], width: 0.67, height: 8, depthIn: 0 });
    const day = { kind: 'day' as const, month: 12, day: 21 };
    const sum = (extra: ReturnType<typeof hardscapeSolids>) => {
      const r = computeSunHours(buildSunScene(site, { aduEnabled: true }, engine, extra), { period: day, year: 2026, config: engine.sun });
      let s = 0;
      for (let k = 0; k < r.hours.length; k++) if (r.mask[k] === 1) s += r.hours[k];
      return s;
    };
    expect(sum(hardscapeSolids([wall], cfg))).toBeLessThan(sum([]) - 5);
  });
});
