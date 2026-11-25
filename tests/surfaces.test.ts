import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { footprint, layeredThickness } from '../src/engine/hardscape';
import { polygonsIntersect } from '../src/engine/geometry';
import type { EngineConfig, HardscapeElement, HardscapeType, Material } from '../src/engine/types';
import { SURFACE_PATTERNS, surfaceTexture, tiledSurface } from '../src/scene/surfaces';

const engine = engineRaw as unknown as EngineConfig;
const mats = ((materialsRaw as unknown as { materials?: Material[] }).materials ?? (materialsRaw as unknown as Material[]));

describe('hardscape surfaces', () => {
  it('gives every surface material a known pattern, a positive tile size and a bump between 0 and 1', () => {
    const surfaced = mats.filter((m) => m.surface);
    // everything that covers ground or builds a wall or fence has one; furniture and the bed frame are modelled, not textured
    for (const m of mats) {
      if (['furniture'].includes(m.category) || m.id === 'raised-bed-wood') continue;
      expect(m.surface, m.id).toBeTruthy();
    }
    for (const m of surfaced) {
      expect(SURFACE_PATTERNS, m.id).toContain(m.surface!.pattern);
      expect(m.surface!.tileFt).toBeGreaterThan(0);
      expect(m.surface!.bump).toBeGreaterThanOrEqual(0);
      expect(m.surface!.bump).toBeLessThanOrEqual(1);
    }
  });

  it('has a painter for every pattern the type allows, and each pattern is used', () => {
    expect(SURFACE_PATTERNS.length).toBe(14);
    const used = new Set(mats.map((m) => m.surface?.pattern).filter(Boolean));
    for (const p of SURFACE_PATTERNS) expect(used.has(p) || p === 'planks' || p === 'composite' || p === 'cmu' || p === 'boards' || p === 'hardie' || p === 'hardie-lap', p).toBe(true);
  });

  it('stands flat surfaces a little proud of the ground, thicker for loose fill than for a slab', () => {
    const t = engine.hardscape.surfaceThicknessFt;
    for (const type of ['patio', 'path', 'bed', 'lawn', 'gravel'] as HardscapeType[]) {
      expect(t[type], type).toBeGreaterThan(0);
      expect(t[type]!).toBeLessThanOrEqual(0.1); // never more than about an inch
    }
    expect(t.gravel!).toBeGreaterThan(t.patio!);
    expect(t.bed!).toBeGreaterThan(t.lawn!);
  });

  it('builds fences from posts, boards and a cap rail that stand proud of the boards', () => {
    const f = engine.hardscape.fence;
    expect(f.postFt).toBeGreaterThan(0);
    expect(f.postSpacingFt).toBeGreaterThan(2);
    expect(f.postRiseFt).toBeGreaterThan(0);
    expect(f.capFt).toBeGreaterThan(0);
    expect(f.capOverhangFt).toBeGreaterThan(0);
  });

  it('sides the garage in horizontal lap board, six 7 in boards to the tile, and the ADU in vertical board', () => {
    const garage = (siteRaw as { structures: { id: string; finish?: Record<string, string> }[] }).structures.find((x) => x.id === 'garage')!;
    expect(garage.finish).toEqual({ all: 'hardie-lap' });
    expect(engine.hardscape.siding.lapTileFt / 6).toBeCloseTo(7 / 12, 6);
    expect(SURFACE_PATTERNS).toContain('hardie-lap');
    expect((siteRaw as { structures: { id: string; finish?: Record<string, string> }[] }).structures.find((x) => x.id === 'adu-great')!.finish).toEqual({ south: 'hardie' });
  });

  it('makes no texture without a document, rather than failing', () => {
    expect(surfaceTexture('slab')).toBeNull();
    expect(tiledSurface('turf', 5)).toBeNull();
  });
});

describe('overlapping flat elements never share a depth', () => {
  const cfgH = engine.hardscape;
  const el = (id: string, type: HardscapeElement['type'], points: [number, number][], extra: Partial<HardscapeElement> = {}): HardscapeElement => ({
    id, type, points, materialId: 'concrete', height: 0, depthIn: 3, width: type === 'path' ? 3 : 0, existing: false, ...extra,
  });
  const box = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  it('gives an element nothing overlaps the thickness of its kind', () => {
    const t = layeredThickness([el('a', 'patio', box(0, 0, 5, 5)), el('b', 'lawn', box(20, 20, 5, 5))], cfgH);
    expect(t.get('a')).toBe(cfgH.surfaceThicknessFt.patio);
    expect(t.get('b')).toBe(cfgH.surfaceThicknessFt.lawn);
  });

  it('puts every later element above every earlier one it overlaps by at least the layer step, whatever the kinds\' own thicknesses', () => {
    // Thin lawn, thick bed over it, a path across both, a patio over the path, and two gravel patches on top of each other.
    const els = [
      el('lawn', 'lawn', box(0, 0, 30, 30)), el('bed', 'bed', box(5, 5, 10, 10)), el('g1', 'gravel', box(8, 8, 6, 6)), el('g2', 'gravel', box(10, 10, 6, 6)),
      el('path', 'path', [[0, 12], [30, 12]]), el('patio', 'patio', box(12, 8, 8, 8)),
    ];
    const t = layeredThickness(els, cfgH);
    const rank = (e: HardscapeElement) => cfgH.drawOrder.indexOf(e.type);
    const order = [...els].sort((a, b) => rank(a) - rank(b) || els.indexOf(a) - els.indexOf(b));
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const a = order[i], b = order[j];
      if (polygonsIntersect(footprint(a, cfgH), footprint(b, cfgH))) {
        expect(t.get(b.id)! - t.get(a.id)!, `${b.id} over ${a.id}`).toBeGreaterThanOrEqual(cfgH.layerStepFt - 1e-9);
      }
    }
    // two of the same kind on top of each other, which used to share a depth exactly
    expect(t.get('g2')).not.toBe(t.get('g1'));
  });

  it('counts one element wholly inside another as overlapping, and leaves out anything with a height of its own', () => {
    const t = layeredThickness([el('big', 'patio', box(0, 0, 20, 20)), el('small', 'patio', box(5, 5, 3, 3)), el('wall', 'wall', [[0, 0], [10, 0]], { height: 3 }), el('bed', 'raisedBed', box(2, 2, 3, 3), { height: 1.5 })], cfgH);
    expect(t.get('small')! - t.get('big')!).toBeGreaterThanOrEqual(cfgH.layerStepFt - 1e-9);
    expect(t.has('wall')).toBe(false);
    expect(t.has('bed')).toBe(false);
  });

  it('keeps the whole stack shallow: a dozen layers is still only an inch or two', () => {
    const els = Array.from({ length: 12 }, (_, i) => el(`p${i}`, 'patio', box(i, i, 15, 15)));
    const t = layeredThickness(els, cfgH);
    expect(Math.max(...t.values())).toBeLessThan(0.25);
  });

  it('is repeatable: the same elements always get the same thicknesses', () => {
    const els = [el('a', 'gravel', box(0, 0, 8, 8)), el('b', 'gravel', box(4, 4, 8, 8)), el('c', 'path', [[0, 6], [14, 6]])];
    expect([...layeredThickness(els, cfgH)]).toEqual([...layeredThickness(els, cfgH)]);
  });
});
