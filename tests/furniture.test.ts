import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { generateConcept } from '../src/engine/concept';
import { buildCoverGrid, takeoff } from '../src/engine/hardscape';
import { distanceToPolygon, pointInPolygon, polygonArea, polygonsIntersect } from '../src/engine/geometry';
import { emptyScenarioData } from '../src/engine/scenario';
import { activeStructures, loadSite } from '../src/engine/site';
import { materialAlternatives, mulberry32 } from '../src/engine/shuffle';
import type { EngineConfig, HardscapeElement, Material, SpeciesLibrary } from '../src/engine/types';
import { tableLayout } from '../src/engine/furniture';
import { chairGeometry, grillModel, rectFrame, tableModel } from '../src/scene/furniture';
import { makeAppStore } from '../src/store/store';

const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const cfg = engine.hardscape;
const bounds = (parts: ReturnType<typeof tableModel>) => {
  const box = new THREE.Box3();
  for (const p of parts) box.union(new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute));
  return box;
};

describe('communal table and grilling station', () => {
  it('are drawable types with a preset size and a material', () => {
    for (const t of ['table', 'grill'] as const) {
      expect(cfg.types[t].placeSize, t).toBeDefined();
      expect(cfg.types[t].furniture).toBe(true);
      expect(mats.some((m) => m.id === cfg.types[t].material)).toBe(true);
      expect(cfg.drawOrder).toContain(t);
      expect(cfg.notDrawable ?? []).not.toContain(t);
    }
    // a table for 8: about 8 ft of table plus the chairs at each end; a grill of about 2.5 ft with counters of 1 to 2 ft each side
    expect(cfg.types.table.placeSize![0]).toBeGreaterThanOrEqual(10);
    const [gl, gd] = cfg.types.grill.placeSize!;
    expect((gl - 2.5) / 2).toBeGreaterThanOrEqual(1);
    expect((gl - 2.5) / 2).toBeLessThanOrEqual(2);
    expect(cfg.types.grill.height).toBe(3);
    expect(gd).toBeGreaterThan(1.5);
  });

  it('are placed with one click at their preset size, centered, inside the lot, and selected', () => {
    const s = makeAppStore('edit');
    s.getState().startDrawing('table');
    const id = s.getState().placePreset([30, 100])!;
    const el = s.getState().hardscape.find((e) => e.id === id)!;
    const [a, b] = cfg.types.table.placeSize!;
    expect(polygonArea(el.points)).toBeCloseTo(a * b, 6);
    expect(el.type).toBe('table');
    expect(s.getState().drawing).toBeNull();
    expect(s.getState().selectedElementId).toBe(id);
    const cx = el.points.reduce((x, p) => x + p[0], 0) / 4;
    expect(cx).toBeCloseTo(30, 6);
    // near the lot edge it is pulled back inside
    s.getState().startDrawing('grill');
    const gid = s.getState().placePreset([0.2, 0.2])!;
    const g = s.getState().hardscape.find((e) => e.id === gid)!;
    for (const [x, y] of g.points) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('turns a quarter turn about its center, keeping its size, and undoes', () => {
    const s = makeAppStore('edit');
    s.getState().startDrawing('grill');
    const id = s.getState().placePreset([30, 100])!;
    const before = s.getState().hardscape.find((e) => e.id === id)!;
    const f0 = rectFrame(before.points);
    s.getState().rotateElement(id);
    const after = s.getState().hardscape.find((e) => e.id === id)!;
    const f1 = rectFrame(after.points);
    expect(f1.cx).toBeCloseTo(f0.cx, 6);
    expect(f1.cy).toBeCloseTo(f0.cy, 6);
    expect(Math.abs(Math.abs(f1.angle - f0.angle) - Math.PI / 2)).toBeLessThan(1e-6);
    expect(f1.long).toBeCloseTo(f0.long, 6);
    s.getState().undo();
    expect(s.getState().hardscape.find((e) => e.id === id)!.points).toEqual(before.points);
  });

  it('draws a table with its chairs and a grill between counters inside their footprints', () => {
    const [L, W] = cfg.types.table.placeSize!;
    const t = bounds(tableModel(L, W));
    // the chairs, each at its seat, pushed in, with the chair's own extent
    const chair = new THREE.Box3().setFromBufferAttribute(chairGeometry().getAttribute('position') as THREE.BufferAttribute);
    for (const seat of tableLayout(L, W).seats) {
      const turn = Math.atan2(seat.fy, seat.fx);
      for (const [cx, cy] of [[chair.min.x, chair.min.y], [chair.min.x, chair.max.y], [chair.max.x, chair.min.y], [chair.max.x, chair.max.y]]) {
        t.expandByPoint(new THREE.Vector3(seat.x + cx * Math.cos(turn) - cy * Math.sin(turn), seat.y + cx * Math.sin(turn) + cy * Math.cos(turn), chair.max.z));
      }
    }
    expect(t.max.x).toBeLessThanOrEqual(L / 2 + 1e-6);
    expect(t.min.x).toBeGreaterThanOrEqual(-L / 2 - 1e-6);
    expect(t.max.y).toBeLessThanOrEqual(W / 2 + 1e-6);
    expect(t.min.y).toBeGreaterThanOrEqual(-W / 2 - 1e-6);
    expect(t.min.z).toBeGreaterThanOrEqual(-1e-6);
    expect(t.max.z).toBeLessThan(3.5);
    const [GL, GD] = cfg.types.grill.placeSize!;
    const g = bounds(grillModel(GL, GD));
    expect(g.max.x - g.min.x).toBeGreaterThan(GL - 0.3); // counters out to both ends
    expect(g.max.x - g.min.x).toBeLessThanOrEqual(GL + 0.2);
    expect(g.max.z).toBeGreaterThan(2.8);
    expect(g.max.z).toBeLessThan(3.4);
  });

  it('seats eight, in a ring: three chairs a side and one at each end, each facing the table', () => {
    const { seats } = tableLayout(11, 6.5);
    expect(seats).toHaveLength(8);
    // a chair is a seat, four legs and a back: 6 boxes of 24 vertices
    expect(chairGeometry().getAttribute('position').count).toBe(6 * 24);
    for (const s of seats) {
      expect(Math.hypot(s.fx, s.fy)).toBeCloseTo(1, 9);
      // facing the table: the chair is on the opposite side of the table's middle from where it points
      expect(s.x * s.fx + s.y * s.fy).toBeLessThan(0);
    }
    // neighbors in the ring are close, and the ring closes
    for (let i = 0; i < 8; i++) {
      const a = seats[i], b = seats[(i + 1) % 8];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3.6);
    }
    expect(new Set(seats.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`)).size).toBe(8);
  });

  it('stand on the ground rather than change what covers it, and are not swapped for another material', () => {
    const patio: HardscapeElement = { id: 'p', type: 'patio', points: [[10, 10], [30, 10], [30, 30], [10, 30]], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false };
    const table: HardscapeElement = { id: 't', type: 'table', points: [[12, 12], [23, 12], [23, 18.5], [12, 18.5]], materialId: 'outdoor-table', height: 2.5, depthIn: 0, width: 0, existing: false };
    const lot = { width: 50, depth: 150 };
    const withTable = buildCoverGrid([patio, table], mats, [], lot, cfg);
    const without = buildCoverGrid([patio], mats, [], lot, cfg);
    expect(Array.from(withTable.cls)).toEqual(Array.from(without.cls));
    expect(materialAlternatives(mats.find((m) => m.id === 'outdoor-table'), mats)).toEqual([]);
    expect(takeoff([table], mats, cfg).rows[0].count).toBe(1);
  });
});

describe('furniture in generated concepts', () => {
  const site = loadSite(siteRaw);
  const lib = speciesRaw as unknown as SpeciesLibrary;
  const structures = activeStructures(site, { aduEnabled: true });
  const ctx = { site, structures, species: lib.species, materials: mats, engine, palette: emptyScenarioData(site).palette };
  const run = (seed: number) => generateConcept(ctx, { hardscape: true, plants: true, starredOnly: false }, mulberry32(seed));

  it('turn up in shuffled concepts, as often as the themes ask, and are reported in the counts', () => {
    let tables = 0, grills = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = run(seed);
      n++;
      tables += r.counts.table;
      grills += r.counts.grill;
      expect(r.data.hardscape.filter((e) => e.type === 'table' && !e.existing)).toHaveLength(r.counts.table);
      expect(r.data.hardscape.filter((e) => e.type === 'grill' && !e.existing)).toHaveLength(r.counts.grill);
    }
    expect(tables).toBeGreaterThan(n * 0.3);
    expect(grills).toBeGreaterThan(n * 0.3);
    expect(tables).toBeLessThan(n); // not in every concept: the theme and the room decide
  });

  it('put the table on the patio at its full size, the grill on or beside it, clear of each other and of buildings', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = run(seed);
      const els = r.data.hardscape.filter((e) => !e.existing);
      const patio = els.find((e) => e.type === 'patio');
      const table = els.find((e) => e.type === 'table'), grill = els.find((e) => e.type === 'grill');
      if (table) {
        expect(patio, `seed ${seed}`).toBeDefined();
        for (const [x, y] of table.points) expect(pointInPolygon(x, y, patio!.points)).toBe(true);
        expect(polygonArea(table.points)).toBeCloseTo(engine.hardscape.types.table.placeSize![0] * engine.hardscape.types.table.placeSize![1], 4);
      }
      if (grill) {
        expect(polygonArea(grill.points)).toBeCloseTo(engine.hardscape.types.grill.placeSize![0] * engine.hardscape.types.grill.placeSize![1], 4);
        const onPatio = grill.points.every(([x, y]) => pointInPolygon(x, y, patio!.points));
        const beside = grill.points.some(([x, y]) => distanceToPolygon(x, y, patio!.points) < 1.6);
        expect(onPatio || beside, `seed ${seed}`).toBe(true);
      }
      if (table && grill) expect(polygonsIntersect(table.points, grill.points)).toBe(false);
      for (const f of [table, grill]) {
        if (!f) continue;
        for (const s of structures) {
          expect(polygonsIntersect(f.points, s.footprint)).toBe(false);
          for (const [x, y] of f.points) expect(distanceToPolygon(x, y, s.footprint)).toBeGreaterThanOrEqual(engine.concept.structureMarginFt - 1e-6);
        }
        // nobody plants in them
        for (const i of r.data.instances) expect(pointInPolygon(i.position[0], i.position[1], f.points)).toBe(false);
      }
    }
  });
});
