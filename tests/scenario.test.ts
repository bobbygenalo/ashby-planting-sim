import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import waterRaw from '../src/data/water.json';
import { solarPosition } from '../src/engine/solar';
import { loadSite } from '../src/engine/site';
import {
  OWNER_PICKS, WORKSPACE_KEY, buildShareSnapshot, compareMetrics, emptyScenarioData, loadWorkspace, parseScenarioFile, parseShareSnapshot,
  redactSite, saveWorkspace, scenarioMetrics, serializeScenarioFile, type KeyValueStorage, type ScenarioData, type ValidationContext, type Workspace,
} from '../src/engine/scenario';
import type { EngineConfig, Material, PlantInstance, Species, SpeciesLibrary, WaterConfig } from '../src/engine/types';
import { makeCustomSpecies } from '../src/engine/library';

const engine = engineRaw as unknown as EngineConfig;
const water = waterRaw as unknown as WaterConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const site = loadSite(siteRaw);
const ctx: ValidationContext = {
  speciesIds: new Set(lib.species.map((s) => s.id)), containers: new Set(Object.keys(engine.growth.containers)),
  hardscapeTypes: new Set(Object.keys(engine.hardscape.types)), materialIds: new Set(mats.map((m) => m.id)), zoneIds: new Set(site.zones.map((z) => z.id)),
};
let n = 0;
const inst = (speciesId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: `q${n++}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false, ...over,
});
const withPlants = (list: PlantInstance[]): ScenarioData => {
  const d = emptyScenarioData(site);
  for (const i of list) d.palette[i.speciesId] = true;
  return { ...d, instances: list };
};
const memory = (): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
const overrides = { soilProfiles: { back_yard: { texture: 'clay', drainageInHr: 0.3, ph: 7.4, organicMatterPct: 2, compaction: 'hard pan', testDate: '2026-03-02', isDefault: false } }, playZones: { front_yard: true } };

describe('scenario data', () => {
  it('starts a new scenario with the owner picks, no plants, and the lot\'s existing hardscape', () => {
    const d = emptyScenarioData(site);
    expect(Object.keys(d.palette).sort()).toEqual([...OWNER_PICKS].sort());
    expect(d.instances).toEqual([]);
    expect(d.hardscape.map((e) => e.id)).toEqual(['driveway']);
    expect(d.aduEnabled).toBe(true);
    d.hardscape[0].removed = true; // editing a scenario must not touch the site file
    expect(site.hardscape[0].removed).toBeUndefined();
    expect(emptyScenarioData(site).hardscape[0].removed).toBeUndefined();
  });
});

describe('export and import (SC-2)', () => {
  it('round-trips a scenario through a JSON file', () => {
    const data = withPlants([inst('salvia-clevelandii', 30, 90), inst('cercis-occidentalis', 28, 100, { container: '15gal', hydrozoneId: 'z1' })]);
    data.hydrozones = [{ id: 'z1', name: 'Back beds', irrigation: 'spray' }];
    data.useRain = true;
    data.aduEnabled = false;
    const text = serializeScenarioFile({ name: 'Option A', data, customSpecies: [], siteOverrides: overrides, now: new Date('2026-12-01T10:00:00Z') });
    expect(JSON.parse(text).format).toBe('ashby-scenario/1');
    const back = parseScenarioFile(text, ctx);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.name).toBe('Option A');
    expect(back.data).toEqual(data);
    expect(back.siteOverrides).toEqual(overrides);
    expect(back.warnings).toEqual([]);
  });

  it('carries custom species the scenario uses, and only those', () => {
    const made = makeCustomSpecies({ common: 'My Shrub', type: 'shrub', origin: 'other', evergreen: true, matureHeight: 4, matureWidth: 4, yearsToMaturity: 3, habit: 'round', sun: 'full', wucols: 'low', bloomMonths: [4], bloomColor: '#ff00ff', pollinatorValue: 'high', groups: [], invasive: false, toxic: false }, []);
    if (!made.ok) throw new Error('bad custom species');
    const spare = { ...made.species, id: 'custom-unused' } as Species;
    const data = withPlants([inst(made.species.id, 30, 90)]);
    const text = serializeScenarioFile({ name: 'Custom', data, customSpecies: [made.species, spare], siteOverrides: overrides });
    const back = parseScenarioFile(text, ctx);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.customSpecies.map((s) => s.id)).toEqual([made.species.id]); // the plants use it; its id is not in the base library
    expect(back.data.instances.length).toBe(1);
  });

  it('rejects files that are not scenarios, with a reason in plain words', () => {
    const bad = (t: string) => parseScenarioFile(t, ctx);
    expect(bad('not json')).toEqual({ ok: false, errors: ['This is not a JSON file.'] });
    expect(bad('{"format":"other"}').ok).toBe(false);
    expect(bad('[]').ok).toBe(false);
    const good = JSON.parse(serializeScenarioFile({ name: 'X', data: withPlants([inst('salvia-clevelandii', 30, 90)]), customSpecies: [], siteOverrides: overrides }));
    const mutate = (fn: (f: Record<string, any>) => void) => { const f = JSON.parse(JSON.stringify(good)); fn(f); return bad(JSON.stringify(f)); };
    const r1 = mutate((f) => { f.scenario.instances[0].container = '55gal'; });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors[0]).toContain('unknown container');
    const r2 = mutate((f) => { f.scenario.hardscape[0].type = 'moat'; });
    expect(r2.ok).toBe(false);
    const r3 = mutate((f) => { f.scenario.hardscape[0].materialId = 'unobtainium'; });
    expect(r3.ok).toBe(false);
    const r4 = mutate((f) => { f.scenario.instances[0].position = [1]; });
    expect(r4.ok).toBe(false);
    const r5 = mutate((f) => { delete f.scenario.palette; });
    expect(r5.ok).toBe(false);
    const r6 = mutate((f) => { f.name = '  '; });
    expect(r6.ok).toBe(false);
    const r7 = mutate((f) => { f.scenario.hydrozones = [{ id: 'z', name: 'Z', irrigation: 'firehose' }]; });
    expect(r7.ok).toBe(false);
  });

  it('drops plants of unknown species with a warning instead of failing the whole file', () => {
    const good = JSON.parse(serializeScenarioFile({ name: 'X', data: withPlants([inst('salvia-clevelandii', 30, 90)]), customSpecies: [], siteOverrides: overrides }));
    good.scenario.instances.push({ ...good.scenario.instances[0], id: 'ghost', speciesId: 'mystery-plant' });
    good.scenario.palette['mystery-plant'] = true;
    const r = parseScenarioFile(JSON.stringify(good), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.instances.map((i) => i.id)).not.toContain('ghost');
    expect(r.data.palette['mystery-plant']).toBeUndefined();
    expect(r.warnings.length).toBe(2);
  });

  it('removes hydrozone references that point nowhere', () => {
    const good = JSON.parse(serializeScenarioFile({ name: 'X', data: withPlants([inst('salvia-clevelandii', 30, 90, { hydrozoneId: 'gone' })]), customSpecies: [], siteOverrides: overrides }));
    const r = parseScenarioFile(JSON.stringify(good), ctx);
    expect(r.ok && r.data.instances[0].hydrozoneId).toBeFalsy();
  });
});

describe('autosave storage (SC-2)', () => {
  const ws = (): Workspace => {
    const d = withPlants([inst('salvia-clevelandii', 30, 90)]);
    return { format: 'ashby-workspace/1', scenarios: [{ id: 's1', name: 'Scenario 1', createdAt: 'a', modifiedAt: 'b' }], data: { s1: d }, activeId: 's1', customSpecies: [], siteOverrides: overrides, shares: [] };
  };
  it('saves and restores a workspace', () => {
    const st = memory();
    const w = ws();
    expect(saveWorkspace(st, w)).toEqual({ ok: true });
    expect(st.map.has(WORKSPACE_KEY)).toBe(true);
    expect(loadWorkspace(st)).toEqual(w);
  });
  it('treats empty, corrupt, wrong-version or inconsistent storage as nothing saved', () => {
    const st = memory();
    expect(loadWorkspace(st)).toBeNull();
    st.setItem(WORKSPACE_KEY, '{oops');
    expect(loadWorkspace(st)).toBeNull();
    st.setItem(WORKSPACE_KEY, JSON.stringify({ ...ws(), format: 'ashby-workspace/9' }));
    expect(loadWorkspace(st)).toBeNull();
    st.setItem(WORKSPACE_KEY, JSON.stringify({ ...ws(), activeId: 'missing' }));
    expect(loadWorkspace(st)).toBeNull();
    st.setItem(WORKSPACE_KEY, JSON.stringify({ ...ws(), scenarios: [] }));
    expect(loadWorkspace(st)).toBeNull();
  });
  it('reports a failed save (full or blocked storage) instead of throwing', () => {
    const blocked: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
    const r = saveWorkspace(blocked, ws());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Quota');
    const throwingRead: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined, removeItem: () => undefined };
    expect(loadWorkspace(throwingRead)).toBeNull();
  });
});

describe('hiding the address (SH-3, NF-6)', () => {
  const data = withPlants([inst('salvia-clevelandii', 30, 90)]);
  const snapshot = (hide: boolean) => buildShareSnapshot({ name: 'Option A', site, data, customSpecies: [], siteOverrides: overrides, hideAddress: hide, view: { timelineMonth: 12, doy: 172 }, now: new Date('2026-12-01T10:00:00Z') });

  it('keeps the address when asked and removes name and address when hidden', () => {
    expect(JSON.stringify(snapshot(false))).toContain('Ashby');
    const hidden = JSON.stringify(snapshot(true));
    expect(hidden).not.toContain('Ashby');
    expect(hidden).not.toContain('10641');
    expect(snapshot(true).site.name).toBe('Shared lot');
    expect(snapshot(true).site.address).toBe('');
    expect(snapshot(true).hideAddress).toBe(true);
  });

  it('rounds coordinates to 0.1 degree, which leaves the sun accurate to a fraction of a degree', () => {
    const red = redactSite(site, true);
    expect(red.latitude).toBeCloseTo(34.0, 6);
    expect(red.longitude).toBeCloseTo(-118.4, 6);
    for (const month of [3, 6, 9, 12]) {
      for (const hour of [9, 12, 15]) {
        const t = Date.UTC(2026, month - 1, 21, hour + 8, 0);
        const a = solarPosition(t, site.latitude, site.longitude), b = solarPosition(t, red.latitude, red.longitude);
        expect(Math.abs(a.elevationDeg - b.elevationDeg)).toBeLessThan(0.5);
        expect(Math.abs(a.azimuthDeg - b.azimuthDeg)).toBeLessThan(0.5);
      }
    }
  });

  it('keeps the lot layout, since that is the plan, and never edits the owner\'s own site', () => {
    const red = redactSite(site, true);
    expect(red.lot).toEqual(site.lot);
    expect(red.structures).toEqual(site.structures);
    expect(site.name).toBe('10641 Ashby Ave');
    expect(redactSite(site, false)).toEqual(site);
    expect(redactSite(site, false)).not.toBe(site);
  });

  it('contains no personal details beyond the lot and, unless hidden, the address', () => {
    const text = JSON.stringify(snapshot(true));
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no email addresses
    expect(Object.keys(snapshot(true)).sort()).toEqual(['createdAt', 'customSpecies', 'format', 'hideAddress', 'name', 'scenario', 'site', 'siteOverrides', 'view']);
  });

  it('only includes custom species the plan uses', () => {
    const made = makeCustomSpecies({ common: 'Mine', type: 'shrub', origin: 'other', evergreen: true, matureHeight: 4, matureWidth: 4, yearsToMaturity: 3, habit: 'round', sun: 'full', wucols: 'low', bloomMonths: [], bloomColor: '#fff', pollinatorValue: 'low', groups: [], invasive: false, toxic: false }, []);
    if (!made.ok) throw new Error('bad');
    const s = buildShareSnapshot({ name: 'X', site, data, customSpecies: [made.species], siteOverrides: overrides, hideAddress: true, view: { timelineMonth: 0, doy: 100 } });
    expect(s.customSpecies).toEqual([]);
  });

  it('a viewer accepts the snapshot it was built from, and refuses anything else', () => {
    const snap = snapshot(true);
    const ok = parseShareSnapshot(JSON.parse(JSON.stringify(snap)), ctx);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.snapshot.scenario).toEqual(snap.scenario);
      expect(ok.snapshot.view).toEqual({ timelineMonth: 12, doy: 172 });
      expect(ok.snapshot.site.name).toBe('Shared lot');
      expect(ok.snapshot.siteOverrides.playZones).toEqual({ front_yard: true });
    }
    expect(parseShareSnapshot({ format: 'nope' }, ctx).ok).toBe(false);
    expect(parseShareSnapshot(null, ctx).ok).toBe(false);
    const noSite = JSON.parse(JSON.stringify(snap));
    delete noSite.site;
    expect(parseShareSnapshot(noSite, ctx).ok).toBe(false);
    const badPlant = JSON.parse(JSON.stringify(snap));
    badPlant.scenario.instances[0].container = 'barrel';
    expect(parseShareSnapshot(badPlant, ctx).ok).toBe(false);
  });
});

describe('comparing scenarios (SC-3)', () => {
  const mctx = { site, engine, water, species: lib.species, materials: mats, timelineMonth: 60 };
  const plain = withPlants([inst('salvia-clevelandii', 38, 100), inst('epilobium-canum', 44, 92), inst('arctostaphylos-howard-mcminn', 30, 112)]);
  const thirsty = withPlants([inst('polygala-myrtifolia', 38, 100), inst('agapanthus-africanus', 44, 92), inst('lomandra-longifolia', 30, 112)]);
  const crowded = withPlants([inst('cercis-occidentalis', 10, 79.5, { container: '15gal' })]);

  it('measures plants, canopy, water, hardscape, conflicts and pollinator value', () => {
    const m = scenarioMetrics(plain, mctx);
    expect(m.plants).toBe(3);
    expect(m.canopySf).toBeGreaterThan(20);
    expect(m.annualWaterGal).toBeGreaterThan(0);
    expect(m.hardscapeSf).toBe(0);
    expect(m.conflicts).toBe(0);
    expect(m.highValueShare).toBe(1);
    expect(scenarioMetrics(emptyScenarioData(site), mctx)).toMatchObject({ plants: 0, canopySf: 0, annualWaterGal: 0, bloomGapMonths: 12 });
  });

  it('shows a thirstier palette using more water and a badly placed tree causing conflicts', () => {
    expect(scenarioMetrics(thirsty, mctx).annualWaterGal).toBeGreaterThan(scenarioMetrics(plain, mctx).annualWaterGal * 1.1);
    expect(scenarioMetrics(crowded, mctx).conflicts).toBeGreaterThanOrEqual(3);
  });

  it('counts new hardscape and rainfall when comparing', () => {
    const patio = { id: 'p', type: 'patio' as const, points: [[30, 70], [40, 70], [40, 82], [30, 82]] as [number, number][], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false };
    const withPatio = { ...plain, hardscape: [...plain.hardscape, patio] };
    const m = scenarioMetrics(withPatio, mctx);
    expect(m.hardscapeSf).toBeCloseTo(120, 6);
    expect(m.hardscapeCuYd).toBeCloseTo(2 * 1.4815, 3);
    const wet = scenarioMetrics({ ...thirsty, useRain: true }, mctx);
    expect(wet.annualWaterGal).toBeLessThan(scenarioMetrics(thirsty, mctx).annualWaterGal);
  });

  it('builds side-by-side rows with the difference and which way is better', () => {
    const rows = compareMetrics(scenarioMetrics(plain, mctx), scenarioMetrics(thirsty, mctx));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows.map((r) => r.id)).toEqual(['plants', 'canopySf', 'annualWaterGal', 'hardscapeSf', 'hardscapeCuYd', 'conflicts', 'highValueShare', 'bloomGapMonths']);
    expect(byId.annualWaterGal.delta).toBeCloseTo(byId.annualWaterGal.b - byId.annualWaterGal.a, 9);
    expect(byId.annualWaterGal.better).toBe('lower');
    expect(byId.highValueShare.a).toBe(100); // shown as a percent
    expect(byId.highValueShare.b).toBe(0);
    expect(compareMetrics(scenarioMetrics(plain, mctx), scenarioMetrics(plain, mctx)).every((r) => r.delta === 0)).toBe(true);
  });
});
