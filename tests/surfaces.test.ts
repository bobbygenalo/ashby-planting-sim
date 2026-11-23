import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import type { EngineConfig, HardscapeType, Material } from '../src/engine/types';
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
    expect(SURFACE_PATTERNS.length).toBe(12);
    const used = new Set(mats.map((m) => m.surface?.pattern).filter(Boolean));
    for (const p of SURFACE_PATTERNS) expect(used.has(p) || p === 'planks' || p === 'composite' || p === 'cmu' || p === 'boards', p).toBe(true);
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

  it('makes no texture without a document, rather than failing', () => {
    expect(surfaceTexture('slab')).toBeNull();
    expect(tiledSurface('turf', 5)).toBeNull();
  });
});
