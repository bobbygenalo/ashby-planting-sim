import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { activeStructures, loadSite } from '../src/engine/site';
import { emptyScenarioData } from '../src/engine/scenario';
import { lookAlikes, materialAlternatives, mulberry32, shuffleScenario, type ShuffleOptions } from '../src/engine/shuffle';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const ctx = { site, structures: activeStructures(site, { aduEnabled: true }), species: lib.species, materials: mats, engine };
const ALL: ShuffleOptions = { species: true, positions: true, materials: true, colors: true, time: true };
const NONE: ShuffleOptions = { species: false, positions: false, materials: false, colors: false, time: false };

const plant = (id: string, speciesId: string, x: number, y: number, extra: Partial<PlantInstance> = {}): PlantInstance => ({
  id, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false, ...extra,
});
const patio = (id: string, materialId: string, existing = false): HardscapeElement => ({
  id, type: 'patio', points: [[30, 60], [40, 60], [40, 70], [30, 70]], materialId, height: 0, depthIn: 4, width: 0, existing,
});

const data = () => {
  const d = emptyScenarioData(site);
  d.instances = [
    plant('a', 'salvia-leucantha', 36, 105),
    plant('b', 'lantana-montevidensis', 40, 108),
    plant('c', 'ceanothus-concha', 30, 115),
    plant('old', 'achillea-millefolium', 33, 100, { existing: true, currentHeight: 2, currentWidth: 2 }),
  ];
  d.hardscape = [...d.hardscape, patio('p1', 'concrete'), patio('p2', 'pavers-sand', true)];
  return d;
};

describe('shuffle engine', () => {
  it('is repeatable from a seed and different from another', () => {
    const a = shuffleScenario(data(), ctx, ALL, mulberry32(42));
    const b = shuffleScenario(data(), ctx, ALL, mulberry32(42));
    expect(b).toEqual(a);
    const c = shuffleScenario(data(), ctx, ALL, mulberry32(43));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('changes nothing when nothing is chosen, and never touches existing items', () => {
    const d = data();
    expect(shuffleScenario(d, ctx, NONE, mulberry32(1)).data).toEqual(d);
    for (let seed = 1; seed <= 20; seed++) {
      const r = shuffleScenario(d, ctx, ALL, mulberry32(seed));
      expect(r.data.instances.find((i) => i.id === 'old')).toEqual(d.instances.find((i) => i.id === 'old'));
      expect(r.data.hardscape.find((h) => h.id === 'p2')).toEqual(d.hardscape.find((h) => h.id === 'p2'));
      expect(r.data.hardscape.filter((h) => h.existing)).toEqual(d.hardscape.filter((h) => h.existing));
    }
  });

  it('swaps species only for look-alikes: same kind, light, water and about the same size', () => {
    let swaps = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = shuffleScenario(data(), ctx, { ...NONE, species: true }, mulberry32(seed));
      for (const inst of r.data.instances.filter((i) => !i.existing)) {
        const before = data().instances.find((i) => i.id === inst.id)!;
        const from = lib.species.find((s) => s.id === before.speciesId)!;
        const to = lib.species.find((s) => s.id === inst.speciesId)!;
        if (to.id === from.id) continue;
        expect(lookAlikes(from, lib.species, engine.shuffle.sizeRatioBand).map((s) => s.id)).toContain(to.id);
        expect(to.type).toBe(from.type);
        expect(to.sun).toBe(from.sun);
        expect(to.wucols).toBe(from.wucols);
        expect(to.invasive).toBe(false);
        expect(to.matureHeight / from.matureHeight).toBeGreaterThanOrEqual(engine.shuffle.sizeRatioBand[0]);
        expect(to.matureHeight / from.matureHeight).toBeLessThanOrEqual(engine.shuffle.sizeRatioBand[1]);
      }
      expect(r.changes.moved + r.changes.materials + r.changes.colors).toBe(0);
      swaps += r.changes.species;
    }
    expect(swaps).toBeGreaterThan(20); // it really does swap, not just stay inside the rules
  });

  it('nudges plants a short way and keeps them in the lot, off buildings and hard surfaces, and apart', () => {
    let moves = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = shuffleScenario(data(), ctx, { ...NONE, positions: true }, mulberry32(seed));
      r.data.instances.forEach((inst, k) => {
        const before = data().instances[k];
        const dist = Math.hypot(inst.position[0] - before.position[0], inst.position[1] - before.position[1]);
        expect(dist).toBeLessThanOrEqual(engine.shuffle.plantMoveRadiusFt + 0.01);
        expect(inst.position[0]).toBeGreaterThanOrEqual(0);
        expect(inst.position[0]).toBeLessThanOrEqual(site.lot.width);
        expect(inst.position[1]).toBeGreaterThanOrEqual(0);
        expect(inst.position[1]).toBeLessThanOrEqual(site.lot.depth);
        if (dist > 0) {
          for (const s of ctx.structures) expect(pointInPolygon(inst.position[0], inst.position[1], s.footprint)).toBe(false);
          expect(pointInPolygon(inst.position[0], inst.position[1], [[30, 60], [40, 60], [40, 70], [30, 70]])).toBe(false);
        }
      });
      moves += r.changes.moved;
      const ps = r.data.instances.map((i) => i.position);
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const before = Math.hypot(data().instances[i].position[0] - data().instances[j].position[0], data().instances[i].position[1] - data().instances[j].position[1]);
        const after = Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]);
        // Plants that were already closer than the gap are not made worse by a move.
        expect(after >= engine.shuffle.minPlantGapFt - 1e-6 || after >= before - 1e-6).toBe(true);
      }
    }
    expect(moves).toBeGreaterThan(50);
  });

  it('keeps roots off foundations for the plant it moves', () => {
    const d = emptyScenarioData(site);
    d.hardscape = [];
    d.instances = [plant('t', 'olea-frantoio', 40, 95)]; // roots keep 12 ft from foundations; this spot has 20 ft
    const house = ctx.structures.filter((s) => s.group === 'house');
    let moved = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const out = shuffleScenario(d, ctx, { ...NONE, positions: true }, mulberry32(seed)).data.instances[0];
      if (out.position[0] === 40 && out.position[1] === 95) continue;
      moved++;
      for (const s of house) expect(distanceToPolygon(out.position[0], out.position[1], s.footprint)).toBeGreaterThanOrEqual(12 - 1e-6);
    }
    expect(moved).toBeGreaterThan(0);
    // A plant that is already closer than its species wants may move, but never closer to a building.
    const tight = emptyScenarioData(site);
    tight.hardscape = [];
    tight.instances = [plant('t', 'olea-frantoio', 20, 70)];
    const near = (p: [number, number]) => Math.min(...ctx.structures.map((s) => distanceToPolygon(p[0], p[1], s.footprint)));
    let tightMoves = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const out = shuffleScenario(tight, ctx, { ...NONE, positions: true }, mulberry32(seed)).data.instances[0];
      if (out.position[0] === 20 && out.position[1] === 70) continue;
      tightMoves++;
      expect(near(out.position)).toBeGreaterThanOrEqual(near([20, 70]) - 1e-6);
    }
    expect(tightMoves).toBeGreaterThan(0);
  });

  it('swaps materials within the family and never walls, fences or the driveway', () => {
    expect(materialAlternatives(mats.find((m) => m.id === 'concrete'), mats).map((m) => m.id).sort()).toEqual(['flagstone-dry', 'flagstone-mortar', 'pavers-sand']);
    expect(materialAlternatives(mats.find((m) => m.id === 'cmu-wall'), mats)).toEqual([]);
    expect(materialAlternatives(mats.find((m) => m.id === 'lawn'), mats)).toEqual([]);
    const d = data();
    const drive = d.hardscape.find((h) => h.existing && h.keepClear);
    for (let seed = 1; seed <= 15; seed++) {
      const r = shuffleScenario(d, ctx, { ...NONE, materials: true }, mulberry32(seed));
      const p = r.data.hardscape.find((h) => h.id === 'p1')!;
      const m = mats.find((x) => x.id === p.materialId)!;
      expect(m.category).toBe('paving');
      expect(p.depthIn).toBe(m.defaultDepthIn);
      if (drive) expect(r.data.hardscape.find((h) => h.id === drive.id)).toEqual(drive);
    }
  });

  it('recolors new hardscape from its family palette, differently each time', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const r = shuffleScenario(data(), ctx, { ...NONE, colors: true }, mulberry32(seed));
      const p = r.data.hardscape.find((h) => h.id === 'p1')!;
      expect(engine.shuffle.colorsByCategory.paving).toContain(p.color);
      expect(r.changes.colors).toBe(1);
    }
    const first = shuffleScenario(data(), ctx, { ...NONE, colors: true }, mulberry32(3)).data;
    const again = shuffleScenario(first, ctx, { ...NONE, colors: true }, mulberry32(3)).data;
    expect(again.hardscape.find((h) => h.id === 'p1')!.color).not.toBe(first.hardscape.find((h) => h.id === 'p1')!.color);
  });

  it('picks a growth year and a sun date and time inside the allowed ranges', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = shuffleScenario(data(), ctx, { ...NONE, time: true }, mulberry32(seed)).time!;
      expect(engine.shuffle.timeYearsFrom.map((y) => y * 12)).toContain(t.timelineMonth);
      expect(t.doy).toBeGreaterThanOrEqual(1);
      expect(t.doy).toBeLessThanOrEqual(365);
      expect(t.minutes).toBeGreaterThanOrEqual(engine.shuffle.sunMinutesFrom);
      expect(t.minutes).toBeLessThanOrEqual(engine.shuffle.sunMinutesTo);
      expect((t.minutes - engine.shuffle.sunMinutesFrom) % engine.shuffle.sunMinutesStep).toBe(0);
    }
    expect(shuffleScenario(data(), ctx, { ...NONE, species: true }, mulberry32(1)).time).toBeNull();
  });
});

describe('shuffle in the store', () => {
  const setup = () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    g().addInstance('salvia-leucantha', [36, 105]);
    g().addInstance('lantana-montevidensis', [40, 108]);
    g().startDrawing('patio');
    [[30, 60], [40, 60], [40, 70], [30, 70]].forEach((p) => g().addDrawPoint(p as [number, number]));
    g().finishDrawing();
    return { s, g };
  };

  it('shuffles into a copy and leaves the original exactly as it was', () => {
    const { s, g } = setup();
    const originalId = g().activeScenarioId;
    const before = JSON.stringify({ i: g().instances, h: g().hardscape });
    const r = g().shuffle(ALL, { copy: true, seed: 7 })!;
    expect(r.scenarioId).toBeTruthy();
    expect(g().activeScenarioId).toBe(r.scenarioId);
    expect(g().scenarios.find((x) => x.id === r.scenarioId)!.name).toBe('Shuffle 1');
    g().switchScenario(originalId);
    expect(JSON.stringify({ i: g().instances, h: g().hardscape })).toBe(before);
    void s;
  });

  it('shuffles in place and Undo brings the old plan back', () => {
    const { g } = setup();
    const before = JSON.stringify({ i: g().instances, h: g().hardscape });
    const r = g().shuffle({ ...NONE, species: true, colors: true }, { copy: false, seed: 11 })!;
    expect(r.scenarioId).toBeNull();
    expect(JSON.stringify({ i: g().instances, h: g().hardscape })).not.toBe(before);
    g().undo();
    expect(JSON.stringify({ i: g().instances, h: g().hardscape })).toBe(before);
  });

  it('repeats exactly from the same seed, and moves the sun and timeline when asked', () => {
    const one = setup();
    const two = setup();
    const a = one.g().shuffle({ ...ALL, time: true }, { copy: false, seed: 99 })!;
    const b = two.g().shuffle({ ...ALL, time: true }, { copy: false, seed: 99 })!;
    expect(a.changes).toEqual(b.changes);
    expect(a.time).toEqual(b.time);
    expect(one.g().timelineMonth).toBe(a.time!.timelineMonth);
    expect(one.g().doy).toBe(a.time!.doy);
    expect(one.g().minutes).toBe(a.time!.minutes);
    expect(one.g().instances.map((i) => [i.speciesId, i.position])).toEqual(two.g().instances.map((i) => [i.speciesId, i.position]));
  });

  it('does nothing in view mode', () => {
    expect(makeAppStore('view').getState().shuffle(ALL, { copy: true })).toBeNull();
  });
});
