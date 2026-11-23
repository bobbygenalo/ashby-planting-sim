import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import engineRaw from '../src/data/engine.json';
import { CROPS } from '../src/data/cropLibrary';
import { bladePoints } from '../src/engine/foliage';
import { buildCropPlant } from '../src/engine/cropPlants';
import type { CropCfg, EngineConfig } from '../src/engine/types';
import { cropMeshes } from '../src/scene/cropGeometry';

const engine = engineRaw as unknown as EngineConfig;
const cfg: CropCfg = engine.crops;
const build = (c: (typeof CROPS)[number], seed = 5) => buildCropPlant(c, seed, engine.branches, engine.foliage, cfg);

describe('raised-bed crop plants', () => {
  it('has a look for every crop, and a shape and place for all produce', () => {
    for (const c of CROPS) {
      expect(c.look, c.id).toBeTruthy();
      if (c.produce) {
        expect(c.produce.shape, c.id).toBeTruthy();
        expect(c.produce.place, c.id).toBeTruthy();
      }
    }
  });

  for (const c of CROPS) {
    describe(c.name, () => {
      it('has leaves, stems or blades inside its width and height, and above the soil', () => {
        const p = build(c);
        const f = p.foliage;
        expect(f.leaves.length + f.blades.length).toBeGreaterThan(5);
        const r = c.widthFt / 2;
        for (const l of f.leaves) {
          expect(l.p[2]).toBeGreaterThanOrEqual(-1e-6);
          expect(l.p[2]).toBeLessThanOrEqual(c.heightFt * 1.02);
          expect(Math.hypot(l.p[0], l.p[1])).toBeLessThanOrEqual(r * 1.15 + 0.05);
        }
        for (const b of f.blades) for (const q of bladePoints(b, 12)) {
          expect(Math.hypot(q[0], q[1])).toBeLessThanOrEqual(r + 1e-6);
          expect(q[2]).toBeLessThanOrEqual(c.heightFt + 1e-6);
          expect(q[2]).toBeGreaterThanOrEqual(-1e-6);
        }
      });

      it('is the same for the same seed and different plants for other seeds', () => {
        expect(build(c, 3)).toEqual(build(c, 3));
        expect(build(c, 3)).not.toEqual(build(c, 4));
      });

      it('carries its produce in the data\'s number, in reach of the plant and not underground', () => {
        const p = build(c);
        expect(p.produce).toHaveLength(c.produce?.count ?? 0);
        for (const q of p.produce) {
          expect(q.p[2]).toBeGreaterThanOrEqual(-1e-6);
          expect(q.p[2]).toBeLessThanOrEqual(c.heightFt * 1.05);
          expect(Math.hypot(q.p[0], q.p[1])).toBeLessThanOrEqual(c.widthFt / 2 + 0.3);
          expect(Math.hypot(...q.dir)).toBeCloseTo(1, 6);
          expect(q.size).toBeGreaterThanOrEqual(cfg.produceMinFt);
        }
      });

      it('builds meshes with finite numbers and colors', () => {
        const m = cropMeshes(c, build(c));
        expect(m.foliage).toBeTruthy();
        const geos = [m.foliage!, ...(c.produce ? [m.produce!] : [])];
        for (const g of geos) {
          for (const a of ['position', 'normal', 'color'] as const) {
            const attr = g.getAttribute(a);
            expect(attr, `${c.id} ${a}`).toBeTruthy();
            expect(Array.from(attr.array as Float32Array).every(Number.isFinite)).toBe(true);
          }
          g.computeBoundingBox();
          const bb = g.boundingBox!;
          expect(bb.min.z).toBeGreaterThanOrEqual(-0.05);
          expect(bb.max.z).toBeLessThanOrEqual(c.heightFt * 1.2 + 0.5);
        }
        if (c.produce) expect(m.produce).toBeInstanceOf(THREE.BufferGeometry);
      });
    });
  }
});
