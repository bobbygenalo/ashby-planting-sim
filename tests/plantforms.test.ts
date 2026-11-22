import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { instanceSize } from '../src/engine/growth';
import type { EngineConfig, PlantInstance, SpeciesLibrary } from '../src/engine/types';
import * as THREE from 'three';
import { canopyRadius } from '../src/engine/canopy';
import { fruitPositions } from '../src/engine/fruit';
import { MIN_FORM_SIZE, partBounds, partGeometry, plantParts, type Part } from '../src/scene/forms';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const containers = Object.keys(engine.growth.containers) as PlantInstance['container'][];
/** Geometry is stored as 32-bit floats, so measurements are good to about a millionth of their size. */
const EPS = 1e-5;

/** Every size a plant takes on its way to maturity and beyond, for every starting container. */
function trajectory(sp: (typeof lib.species)[number]) {
  const sizes: { label: string; height: number; width: number }[] = [];
  const years = [0, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30];
  for (const container of containers) {
    for (const y of years) {
      const inst: PlantInstance = { id: 'x', speciesId: sp.id, position: [0, 0], plantedMonth: 0, container, existing: false };
      const s = instanceSize(inst, sp, Math.round(y * 12), engine.growth);
      sizes.push({ label: `${container} @ ${y} yr`, height: s.height, width: s.width });
    }
  }
  sizes.push({ label: 'existing mature', height: sp.matureHeight, width: sp.matureWidth });
  sizes.push({ label: 'existing small', height: sp.matureHeight * 0.1, width: sp.matureWidth * 0.1 });
  return sizes;
}

const extents = (parts: Part[]) => {
  const bs = parts.map(partBounds);
  return {
    minZ: Math.min(...bs.map((b) => b.min[2])),
    maxZ: Math.max(...bs.map((b) => b.max[2])),
    maxX: Math.max(...bs.map((b) => Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])))),
    maxY: Math.max(...bs.map((b) => Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])))),
    maxRadial: Math.max(...parts.filter((p) => p.material === 'foliage').map((p) => {
      const b = partBounds(p);
      return Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])));
    })),
  };
};

describe('plant forms across every species and growth stage', () => {
  for (const sp of lib.species) {
    it(`${sp.common} (${sp.habit}) stays on the ground, at its height and inside its width`, () => {
      const trunkFrac = engine.growth.trunkClearanceFraction[sp.type] ?? 0;
      for (const s of trajectory(sp)) {
        const h = Math.max(s.height, MIN_FORM_SIZE);
        const r = Math.max(s.width / 2, MIN_FORM_SIZE / 2);
        const parts = plantParts(sp.habit, r, s.height, trunkFrac, 3, sp.crown?.profile);
        const where = `${sp.id} ${s.label} (h ${s.height.toFixed(2)}, w ${s.width.toFixed(2)})`;
        expect(parts.length, where).toBeGreaterThan(0);
        for (const p of parts) {
          for (const v of [...p.position, ...p.rotation, ...p.scale, ...p.args]) expect(Number.isFinite(v), where).toBe(true);
        }
        const e = extents(parts);
        expect(e.minZ, `${where} goes below the ground`).toBeGreaterThanOrEqual(-EPS);
        expect(e.maxZ, `${where} is taller than the plant`).toBeLessThanOrEqual(h * (1 + EPS) + EPS);
        expect(e.maxZ, `${where} falls short of the plant height`).toBeGreaterThanOrEqual(h * 0.97);
        expect(e.maxX, `${where} is wider than the plant (x)`).toBeLessThanOrEqual(r * (1 + 1e-6) + EPS);
        expect(e.maxY, `${where} is wider than the plant (y)`).toBeLessThanOrEqual(r * (1 + 1e-6) + EPS);
        expect(e.maxRadial, `${where} does not fill its width`).toBeGreaterThanOrEqual(r * 0.8 - EPS);
        // foliage never floats: it starts at the trunk's top or the ground
        const foliage = parts.filter((p) => p.material === 'foliage');
        expect(foliage.length, where).toBeGreaterThan(0);
        const trunk = parts.filter((p) => p.material === 'trunk');
        const trunkTop = trunk.length ? Math.max(...trunk.map((p) => partBounds(p).max[2])) : 0;
        const foliageBottom = Math.min(...foliage.map((p) => partBounds(p).min[2]));
        expect(foliageBottom, `${where} floats above its trunk`).toBeLessThanOrEqual(trunkTop + 1e-6 + (trunk.length ? 0 : 0.05));
      }
    });
  }

  it('shows a trunk on every tree and edible once it has height to spare, from the first stage', () => {
    for (const type of ['tree', 'edible'] as const) {
      const frac = engine.growth.trunkClearanceFraction[type];
      expect(frac).toBeGreaterThan(0);
      for (const h of [0.5, 1, 2.5, 5, 20]) {
        const parts = plantParts('round', 2, h, frac);
        expect(parts.some((p) => p.material === 'trunk'), `${type} at ${h} ft`).toBe(true);
      }
    }
    expect(plantParts('round', 2, 4, 0).some((p) => p.material === 'trunk')).toBe(false);
  });

  it('sits a trunkless round shrub on a broad base, not on a point like a ball', () => {
    const [part] = plantParts('round', 4, 5, 0);
    expect(part.shape).toBe('lathe');
    const atGround = silhouetteRadius([part], 0.05);
    expect(atGround).toBeGreaterThan(4 * 0.45); // the base keeps a good share of the width
    expect(atGround).toBeLessThan(4);
    expect(partBounds(part).min[2]).toBeCloseTo(0, 6);
    // a tree on a trunk keeps its full ellipsoid canopy
    expect(plantParts('round', 4, 5, 0.15).some((p) => p.shape === 'ellipsoid')).toBe(true);
  });

  it('draws spreading plants as a dome standing on the ground, never a shell on its side', () => {
    const [d] = plantParts('spreading', 4, 5, 0);
    expect(d.shape).toBe('dome');
    const b = partBounds(d);
    expect(b.max[2]).toBeCloseTo(5, 6);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[0]).toBeCloseTo(4, 2);
    expect(b.min[0]).toBeCloseTo(-4, 2);
    expect(b.max[1]).toBeCloseTo(4, 2);
    expect(b.min[1]).toBeCloseTo(-4, 2);
  });

  it('is the same every time for the same seed, and clumps vary with the seed', () => {
    expect(plantParts('clump', 1.5, 3, 0, 5)).toEqual(plantParts('clump', 1.5, 3, 0, 5));
    expect(plantParts('clump', 1.5, 3, 0, 5)).not.toEqual(plantParts('clump', 1.5, 3, 0, 6));
  });
});

/** The widest the drawn foliage gets at a height, found by slicing its triangles with a horizontal plane. */
function silhouetteRadius(parts: Part[], z: number): number {
  let widest = 0;
  for (const part of parts.filter((p) => p.material === 'foliage')) {
    const g = partGeometry(part);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...part.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)), new THREE.Vector3(...part.scale)));
    const pos = g.getAttribute('position');
    const index = g.getIndex();
    const tri = index ? index.count / 3 : pos.count / 3;
    const at = (n: number) => {
      const k = index ? index.getX(n) : n;
      return new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
    };
    for (let i = 0; i < tri; i++) {
      const v = [at(i * 3), at(i * 3 + 1), at(i * 3 + 2)];
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3];
        if ((a.z - z) * (b.z - z) > 0 || a.z === b.z) continue;
        const s = (z - a.z) / (b.z - a.z);
        widest = Math.max(widest, Math.hypot(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s));
      }
    }
    g.dispose();
  }
  return widest;
}

describe('the shared canopy outline matches the drawn shape, so fruit sits on the plant', () => {
  const cfg = engine.fruit;
  for (const habit of ['round', 'vase', 'columnar', 'spreading'] as const) {
    for (const [r, h, frac] of [[2, 4, 0.15], [5, 10, 0.15], [10, 25, 0.15], [4, 5, 0]] as const) {
      it(`${habit} r ${r} h ${h} trunk ${frac}`, () => {
        const base = h * frac, canopyH = h - base;
        const parts = plantParts(habit, r, h, frac);
        // the outline equals the drawn silhouette (within the roughness of a faceted sphere)
        for (const zf of [0.15, 0.3, 0.5, 0.7, 0.85]) {
          const drawn = silhouetteRadius(parts, base + zf * canopyH);
          expect(Math.abs(drawn - canopyRadius(habit, r, zf, frac === 0)), `outline at ${zf}`).toBeLessThanOrEqual(r * 0.08 + 0.02);
        }
        // and every fruit is on or inside it
        for (const [x, y, z] of fruitPositions(habit, r, base, canopyH, 80, 5, cfg)) {
          const drawn = silhouetteRadius(parts, z);
          expect(Math.hypot(x, y), `fruit at height ${z.toFixed(2)} floats outside the canopy`).toBeLessThanOrEqual(drawn + r * 0.04 + 0.02);
          expect(z).toBeGreaterThanOrEqual(base - 1e-9);
          expect(z).toBeLessThanOrEqual(h + 1e-9);
        }
      });
    }
  }
});
