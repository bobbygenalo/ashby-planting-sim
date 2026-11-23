import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { canopyRadius } from '../src/engine/canopy';
import { bladePoints, buildFlowers, buildFoliage, leafWidthProfile, quantizeSize } from '../src/engine/foliage';
import type { EngineConfig, SpeciesLibrary } from '../src/engine/types';
import { barkRidge, trunkBaseRadius, trunkCenter, trunkRadiusAt, trunkTopRadius } from '../src/engine/trunk';
import { trunkGeometry } from '../src/scene/trunkGeometry';
import { aimMatrix, bladesGeometry, leafGeometry, petalGeometry, plumeGeometry, tubeGeometry } from '../src/scene/foliageGeometry';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const detailed = lib.species.filter((s) => s.look);
const ctxFor = (s: (typeof detailed)[number], f: number, seed = 5) => {
  const h = s.matureHeight * f, r = (s.matureWidth / 2) * f;
  const base = h * (engine.growth.trunkClearanceFraction[s.type] ?? 0);
  return { trunkR: trunkTopRadius(h, engine.trunk), habit: s.habit, r, base, canopyH: h - base, matureR: s.matureWidth / 2, matureH: s.matureHeight, seed, profile: s.crown?.profile, branches: engine.branches, cfg: engine.foliage };
};

describe('detailed plants', () => {
  it('covers every species in the library', () => {
    expect(detailed.map((s) => s.id).sort()).toEqual(lib.species.map((s) => s.id).sort());
  });

  for (const s of detailed) {
    describe(s.common, () => {
      for (const f of [0.1, 0.4, 1]) {
        it(`at ${Math.round(f * 100)}% of full size stays inside its size and under the leaf cap`, () => {
          const ctx = ctxFor(s, f);
          const fol = buildFoliage(s.look!, ctx);
          expect(fol.leaves.length).toBeLessThanOrEqual(engine.foliage.maxLeaves);
          const grounded = ctx.base <= 0.02;
          for (const l of fol.leaves) {
            const zf = (l.p[2] - ctx.base) / ctx.canopyH;
            expect(l.p[2]).toBeGreaterThanOrEqual(-1e-6);
            expect(l.p[2]).toBeLessThanOrEqual(ctx.base + ctx.canopyH * 1.01);
            expect(Math.hypot(l.p[0], l.p[1])).toBeLessThanOrEqual(Math.max(canopyRadius(ctx.habit, ctx.r, Math.min(1, Math.max(0, zf)), grounded, ctx.profile), ctx.r * 0.1) * 1.08 + 0.05);
            expect(Math.hypot(...l.dir)).toBeCloseTo(1, 6);
          }
          for (const b of fol.blades) for (const p of bladePoints(b, 12)) {
            expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(ctx.r * 1.0 + 1e-6);
            expect(p[2]).toBeLessThanOrEqual(ctx.canopyH + 1e-6);
            expect(p[2]).toBeGreaterThanOrEqual(-1e-6);
          }
        });
      }

      it('is the same for the same seed and different for another', () => {
        const a = buildFoliage(s.look!, ctxFor(s, 1, 3));
        expect(buildFoliage(s.look!, ctxFor(s, 1, 3))).toEqual(a);
        expect(buildFoliage(s.look!, ctxFor(s, 1, 4))).not.toEqual(a);
      });

      it('has more leaves, blades or stems as it grows', () => {
        const n = (f: number) => { const x = buildFoliage(s.look!, ctxFor(s, f)); return x.leaves.length + x.blades.length + (x.skeleton?.segments.length ?? 0); };
        expect(n(0.15)).toBeLessThan(n(0.5));
        expect(n(0.5)).toBeLessThan(n(1));
      });

      it('builds every mesh it needs without error, with finite numbers', () => {
        const ctx = ctxFor(s, 1);
        const fol = buildFoliage(s.look!, ctx);
        const fl = buildFlowers(s.look!, fol, ctx);
        const geos: THREE.BufferGeometry[] = [leafGeometry(s.look!.leaf.shape, s.look!.leaf.fold, 0.2)];
        const bg = bladesGeometry(fol.blades, new THREE.Color('#345'), new THREE.Color('#9a8'));
        if (bg) geos.push(bg);
        geos.push(petalGeometry(new THREE.Color('#fff'), new THREE.Color('#fc0')), tubeGeometry(), plumeGeometry());
        for (const g of geos) {
          const pos = g.getAttribute('position').array;
          expect(pos.length).toBeGreaterThan(0);
          expect(Array.from(pos).every(Number.isFinite)).toBe(true);
        }
        const m = new THREE.Matrix4();
        for (const f of fl.flowers.slice(0, 50)) expect(aimMatrix(f.p, f.dir, 0.3, [f.size, f.size, f.size], f.form === 'petal' ? 'z' : 'x', m).elements.every(Number.isFinite)).toBe(true);
      });

      it.skipIf(!s.look!.flower)('shows flowers in the shape its data names, near the plant', () => {
        const ctx = ctxFor(s, 1);
        const fol = buildFoliage(s.look!, ctx);
        const { flowers, stalks } = buildFlowers(s.look!, fol, ctx);
        expect(flowers.length).toBeGreaterThan(5);
        const form = s.look!.flower!.form;
        expect(new Set(flowers.map((f) => f.form))).toEqual(new Set([form === 'blossom' ? 'petal' : form === 'plume' ? 'plume' : form === 'head' ? (s.look!.flower!.unit === 'tube' ? 'tube' : 'petal') : 'tube']));
        if (form !== 'blossom') expect(stalks.length).toBeGreaterThan(0);
        for (const f of flowers) expect(Math.hypot(f.p[0], f.p[1])).toBeLessThanOrEqual(ctx.r * 1.4 + 0.6 + (s.look!.flower!.headFt ?? 0) * 3);
        for (const f of flowers) expect(f.p[2]).toBeLessThanOrEqual(ctx.base + ctx.canopyH + (s.look!.flower!.stalkFt ?? 0) * 1.1 + (s.look!.flower!.headFt ?? 0) * 6 + ctx.canopyH * 0.1 + 0.6);
      });
    });
  }

  it('leaf outlines run from the base to a point, widest at one', () => {
    for (const shape of ['lanceolate', 'elliptic', 'oval', 'strap', 'blade'] as const) {
      const ws = Array.from({ length: 101 }, (_, i) => leafWidthProfile(shape, i / 100));
      expect(Math.max(...ws)).toBeCloseTo(1, 1);
      expect(Math.max(...ws)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.min(...ws)).toBeGreaterThanOrEqual(0);
      expect(ws[100]).toBeLessThan(0.05);
    }
  });

  it('rounds sizes onto a ladder so growth rebuilds a plant only now and then', () => {
    const step = engine.foliage.quantizeStep;
    const seen = new Set<number>();
    for (let h = 0.5; h <= 25; h += 0.01) {
      const q = quantizeSize(h, step);
      seen.add(q);
      expect(Math.abs(Math.log(h / q))).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
    expect(seen.size).toBeLessThan(70);
  });
});

describe('trunks and bark', () => {
  const cfg = engine.trunk;
  it('are widest at the ground, taper to the top, and are thicker on a taller plant', () => {
    const r = (z: number) => trunkRadiusAt(z, 4, 20, cfg);
    expect(r(0)).toBeGreaterThan(r(0.4 * 4));
    expect(r(0.4 * 4)).toBeGreaterThan(r(4));
    // monotone narrowing all the way up
    for (let i = 1; i <= 40; i++) expect(r((i / 40) * 4)).toBeLessThanOrEqual(r(((i - 1) / 40) * 4) + 1e-9);
    expect(r(0)).toBeGreaterThan(r(4) * cfg.flare * 0.95 * 0.99); // the flare
    expect(trunkTopRadius(20, cfg)).toBeCloseTo(r(4) / (1 + (cfg.flare - 1) * Math.exp(-1 / cfg.flareHeightFrac)), 6);
    expect(trunkBaseRadius(30, cfg)).toBeGreaterThan(trunkBaseRadius(10, cfg));
    expect(trunkBaseRadius(500, cfg)).toBeLessThanOrEqual(cfg.maxRadiusFt);
    expect(trunkBaseRadius(0.1, cfg)).toBeGreaterThanOrEqual(cfg.minRadiusFt);
  });

  it('has bark that is only slightly rough, and a trunk that meets the limbs at the middle of the top', () => {
    for (let a = 0; a < 6.3; a += 0.1) for (const z of [0, 1, 2.5]) {
      const v = barkRidge(a, z, 7, cfg);
      expect(Math.abs(v - 1)).toBeLessThanOrEqual(cfg.ridgeAmp * 1.05);
    }
    expect(trunkCenter(4, 4, 7, cfg)).toEqual([0, 0].map((x) => x + 0) as [number, number]);
    const mid = trunkCenter(2, 4, 7, cfg);
    expect(Math.hypot(...mid)).toBeLessThanOrEqual(cfg.sway * 4 + 1e-9);
  });

  it('builds a closed-up mesh that narrows upward, with texture coordinates in feet', () => {
    const g = trunkGeometry(4, 20, 9, cfg);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    expect(pos.count).toBe((cfg.rings + 1) * (cfg.sides + 1));
    expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
    const ring = (i: number) => { const n = cfg.sides + 1; let m = 0; for (let j = 0; j < n; j++) { const k = i * n + j; m = Math.max(m, Math.hypot(pos.getX(k) - pos.getX(i * n + 0) * 0, pos.getY(k))); } return m; };
    expect(ring(0)).toBeGreaterThan(ring(cfg.rings));
    expect(Math.max(...Array.from(uv.array))).toBeGreaterThan(1);
    // the top ring is centered on the plant's axis, where the limbs start
    const top = cfg.rings * (cfg.sides + 1);
    let cx = 0, cy = 0;
    for (let j = 0; j < cfg.sides; j++) { cx += pos.getX(top + j); cy += pos.getY(top + j); }
    expect(Math.hypot(cx / cfg.sides, cy / cfg.sides)).toBeLessThan(trunkTopRadius(20, cfg) * 0.1);
    expect(pos.getZ(top)).toBeCloseTo(4, 5);
  });
});
