import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { canopyRadius, crownSections, profileShare } from '../src/engine/canopy';
import { crownDensity, plantSolid } from '../src/engine/growth';
import type { EngineConfig, PlantInstance, Species, SpeciesLibrary } from '../src/engine/types';
import { plantParts } from '../src/scene/forms';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const inst = (id: string): PlantInstance => ({ id: `t-${id}`, speciesId: id, position: [20, 80], plantedMonth: 0, container: '5gal', existing: false });

describe('crown profiles', () => {
  it('give every species with one a valid outline: ascending, closed at the top, never wider than the canopy', () => {
    const withProfile = lib.species.filter((s) => s.crown?.profile);
    expect(withProfile.map((s) => s.id)).toContain('olea-frantoio');
    for (const s of withProfile) {
      const pr = s.crown!.profile!;
      expect(pr[0][0], s.id).toBe(0);
      expect(pr[pr.length - 1], s.id).toEqual([1, 0]);
      pr.forEach(([z, r], i) => {
        expect(r, s.id).toBeGreaterThanOrEqual(0);
        expect(r, s.id).toBeLessThanOrEqual(1);
        if (i > 0) expect(z, s.id).toBeGreaterThan(pr[i - 1][0]);
      });
      expect(Math.max(...pr.map((p) => p[1])), `${s.id} should reach the full width somewhere`).toBe(1);
    }
  });

  it('interpolates smoothly without swelling past the points it passes through', () => {
    const pr = sp('olea-frantoio').crown!.profile!;
    const cap = Math.max(...pr.map((p) => p[1]));
    for (let i = 0; i <= 200; i++) {
      const v = profileShare(pr, i / 200);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(cap + 1e-9);
    }
    for (const [z, r] of pr) expect(profileShare(pr, z)).toBeCloseTo(r, 9);
  });

  it('draws the Frantoio as a rounded oval: widest around the middle, narrower both above and below, no flat top', () => {
    const f = sp('olea-frantoio');
    const widest = Array.from({ length: 101 }, (_, i) => i / 100).reduce((a, z) => (canopyRadius(f.habit, 10, z, false, f.crown!.profile) > canopyRadius(f.habit, 10, a, false, f.crown!.profile) ? z : a), 0);
    expect(widest).toBeGreaterThan(0.35);
    expect(widest).toBeLessThan(0.65);
    const at = (z: number) => canopyRadius(f.habit, 10, z, false, f.crown!.profile);
    expect(at(0.98)).toBeLessThan(at(0.9) * 0.6); // the top closes in, not a flat disc
    expect(at(0.1)).toBeLessThan(at(widest) * 0.85);
    // a full oval, not a cone: the bottom of the crown is still well over half its width
    expect(at(0)).toBeGreaterThan(at(widest) * 0.4);
    expect(at(0.1)).toBeGreaterThan(at(widest) * 0.6);
  });

  it('draw the same outline the shadow is built from', () => {
    const f = sp('olea-frantoio');
    const size = { planted: true, height: 25, width: 20 };
    const so = plantSolid(inst(f.id), f, size, engine.growth, 12)!;
    const base = 25 * (engine.growth.trunkClearanceFraction[f.type] ?? 0);
    const sections = crownSections(f.habit, 10, base, 25 - base, engine.growth.shadowLevels, false, f.crown!.profile);
    for (const [z, radius] of sections) {
      const ring = so.points.filter((p) => Math.abs(p[2] - z) < 1e-9);
      expect(ring.length).toBe(12);
      for (const p of ring) expect(Math.hypot(p[0] - 20, p[1] - 80)).toBeCloseTo(radius, 6);
    }
    // and the drawn lathe passes through the same radii
    const lathe = plantParts(f.habit, 10, 25, engine.growth.trunkClearanceFraction[f.type] ?? 0, 1, f.crown!.profile).find((p) => p.shape === 'lathe')!;
    for (let i = 2; i < lathe.args.length; i += 2) {
      const zf = lathe.args[i + 1] / (25 - base);
      expect(lathe.args[i]).toBeCloseTo(canopyRadius(f.habit, 10, zf, false, f.crown!.profile), 6);
    }
  });

  it('casts shade from every species with the section count the config asks for, inside its canopy width', () => {
    for (const s of lib.species) {
      const so = plantSolid(inst(s.id), s, { planted: true, height: s.matureHeight, width: s.matureWidth }, engine.growth, 12);
      if (!so) continue;
      expect(so.points.length, s.id).toBe(12 * engine.growth.shadowLevels);
      for (const p of so.points) expect(Math.hypot(p[0] - 20, p[1] - 80), s.id).toBeLessThanOrEqual(s.matureWidth / 2 + 1e-6);
    }
  });
});

describe('light through a crown', () => {
  const big = { planted: true, height: 20, width: 16 };

  it("uses a species' own density, else its plant type's", () => {
    const olive = sp('olea-arbequina'), lemon = sp('citrus-meyer-lemon');
    expect(crownDensity(olive, engine.growth)).toBe(olive.crown!.density);
    expect(crownDensity({ ...lemon, crown: undefined } as Species, engine.growth)).toBe(engine.growth.shadowDensityByType[lemon.type]);
    expect(plantSolid(inst(olive.id), olive, big, engine.growth, 12)!.density).toBe(olive.crown!.density);
  });

  it('lets an olive pass more light than citrus or a persimmon, and uses a bare-crown value when one is given', () => {
    const d = (id: string) => crownDensity(sp(id), engine.growth);
    expect(d('olea-frantoio')).toBeLessThan(d('citrus-satsuma'));
    expect(d('olea-arbequina')).toBeLessThan(d('diospyros-kaki-hachiya'));
    const own = { ...sp('malus-mutsu'), crown: { density: 0.8, leafOffDensity: 0.1 } } as Species;
    expect(plantSolid(inst(own.id), own, big, engine.growth, 12)!.leafOffDensity).toBe(0.1);
  });

  it('keeps every density a share between 0 and 1', () => {
    for (const s of lib.species) {
      const v = crownDensity(s, engine.growth);
      expect(v, s.id).toBeGreaterThan(0);
      expect(v, s.id).toBeLessThanOrEqual(1);
      if (s.crown?.leafOffDensity !== undefined) expect(s.crown.leafOffDensity).toBeLessThanOrEqual(1);
    }
  });
});
