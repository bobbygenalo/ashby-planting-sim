import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { buildLifeWorld, hiveProblems, type HiveCheck } from '../src/engine/life';
import { emptyScenarioData, validateScenarioData } from '../src/engine/scenario';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, Material, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });

describe('placing the beehive', () => {
  const check: HiveCheck = {
    lot: site.lot,
    structures: structures.map((s) => s.footprint),
    plants: [{ x: 40, y: 100, r: 3 }],
    paths: [[[30, 95], [33, 95], [33, 110], [30, 110]]],
  };

  it('explains what is wrong with a spot, and says nothing about a good one', () => {
    const cfg = engine.life;
    expect(hiveProblems({ x: 0.5, y: 100 }, check, cfg).join()).toMatch(/lot edge/);
    expect(hiveProblems({ x: 10, y: 90 }, check, cfg).join()).toMatch(/building/); // inside the garage
    expect(hiveProblems({ x: 41, y: 100 }, check, cfg).join()).toMatch(/plant/);
    expect(hiveProblems({ x: 36, y: 100 }, check, cfg).join()).toMatch(/path/);
    expect(hiveProblems({ x: 45, y: 60 }, { ...check, structures: [], plants: [], paths: [] }, cfg)).toEqual([]);
  });

  it('is where the owner put it, good spot or not, and the app chooses otherwise', () => {
    const base = { site, structures, hardscape: site.hardscape as never, materials: mats, plants: [], month: 5, engine };
    const placed = buildLifeWorld({ ...base, hiveAt: { x: 38.5, y: 101.5 } });
    expect(placed.hive).toEqual({ x: 38.5, y: 101.5 });
    const auto = buildLifeWorld(base);
    expect(auto.hive).not.toBeNull();
    expect(auto.hive).not.toEqual({ x: 38.5, y: 101.5 });
    // the cells around the owner's hive are blocked to walkers
    const k = Math.floor(101.5 / placed.cell) * placed.nx + Math.floor(38.5 / placed.cell);
    expect(placed.blocked[k]).toBe(1);
  });
});

describe('the hive in the store', () => {
  it('moves, undoes, and is per scenario', () => {
    const s = makeAppStore('edit');
    expect(s.getState().hive).toBeNull();
    s.getState().setHive([30, 100]);
    expect(s.getState().hive).toEqual([30, 100]);
    s.getState().beginGesture();
    s.getState().moveHive([32, 100]);
    expect(s.getState().hive).toEqual([32, 100]);
    s.getState().undo();
    expect(s.getState().hive).toEqual([30, 100]);
    s.getState().undo();
    expect(s.getState().hive).toBeNull();
    s.getState().setHive([30, 100]);
    const first = s.getState().activeScenarioId;
    s.getState().createScenario();
    expect(s.getState().hive).toBeNull();
    s.getState().switchScenario(first);
    expect(s.getState().hive).toEqual([30, 100]);
  });

  it('is selected on its own, deselecting a plant or element, and view mode cannot move it', () => {
    const s = makeAppStore('edit');
    s.getState().addInstance(lib.species[0].id, [20, 90]);
    s.getState().select(s.getState().instances[0].id);
    s.getState().selectHive(true);
    expect(s.getState().hiveSelected).toBe(true);
    expect(s.getState().selectedId).toBeNull();
    s.getState().select(s.getState().instances[0].id);
    expect(s.getState().hiveSelected).toBe(false);
    const v = makeAppStore('view');
    v.getState().setHive([30, 100]);
    v.getState().moveHive([31, 100]);
    expect(v.getState().hive).toBeNull();
  });

  it('is saved with the scenario and survives a round trip through validation', () => {
    const ctx = { speciesIds: new Set(lib.species.map((x) => x.id)), containers: new Set(Object.keys(engine.growth.containers)), hardscapeTypes: new Set(Object.keys(engine.hardscape.types)), materialIds: new Set(mats.map((m) => m.id)), zoneIds: new Set(site.zones.map((z) => z.id)) };
    const d = { ...emptyScenarioData(site), hive: [33, 99] as [number, number] };
    expect(validateScenarioData(JSON.parse(JSON.stringify(d)), ctx).data!.hive).toEqual([33, 99]);
    expect(validateScenarioData({ ...d, hive: 'nope' }, ctx).data!.hive).toBeNull();
    expect(validateScenarioData({ ...d, hive: [1, NaN] }, ctx).data!.hive).toBeNull();
    const { hive: _h, ...older } = d;
    void _h;
    expect(validateScenarioData(older, ctx).data!.hive).toBeNull();
  });
});
