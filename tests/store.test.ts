import { describe, expect, it } from 'vitest';
import { makeCustomSpecies } from '../src/engine/library';
import { makeAppStore } from '../src/store/store';

describe('view mode', () => {
  it('blocks plan mutations at the store level but allows viewing controls', () => {
    const view = makeAppStore('view');
    view.getState().setAduEnabled(false);
    expect(view.getState().aduEnabled).toBe(true);
    const site = view.getState().site;
    view.getState().replaceSite({ ...site, name: 'changed' });
    expect(view.getState().site.name).toBe(site.name);
    // Viewers can still orbit, scrub time and toggle layers.
    view.getState().setDoy(10);
    view.getState().setLayer('sunHours', false);
    view.getState().setView('plan');
    expect(view.getState().doy).toBe(10);
    expect(view.getState().layers.sunHours).toBe(false);
    expect(view.getState().view).toBe('plan');
  });

  it('lets the owner mutate in edit mode', () => {
    const edit = makeAppStore('edit');
    edit.getState().setAduEnabled(false);
    expect(edit.getState().aduEnabled).toBe(false);
  });
});

describe('hardscape drawing and history (M4)', () => {
  const draw = (store: ReturnType<typeof makeAppStore>, type: "patio" | "path" | "wall", pts: [number, number][]) => {
    store.getState().startDrawing(type);
    for (const p of pts) store.getState().addDrawPoint(p);
    return store.getState().finishDrawing();
  };

  it('draws a patio from its corners with the type defaults, selects it, and ends drawing', () => {
    const s = makeAppStore('edit');
    const id = draw(s, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])!;
    const el = s.getState().hardscape.find((e) => e.id === id)!;
    expect(el.materialId).toBe('concrete');
    expect(el.depthIn).toBe(4);
    expect(el.existing).toBe(false);
    expect(s.getState().selectedElementId).toBe(id);
    expect(s.getState().drawing).toBeNull();
  });

  it('rejects collapsed shapes with no area or no length', () => {
    const s = makeAppStore('edit');
    expect(draw(s, 'patio', [[0, 0], [10, 0], [0, 0], [10, 0]])).toBeNull();
    expect(draw(s, 'patio', [[0, 0], [5, 0], [10, 0]])).toBeNull();
    expect(s.getState().hardscape.some((e) => !e.existing)).toBe(false);
    expect(draw(s, 'path', [[3, 3], [3.1, 3]])).toBeNull();
  });

  it('needs enough points: 3 for an area, 2 for a line', () => {
    const s = makeAppStore('edit');
    expect(draw(s, 'patio', [[0, 0], [5, 0]])).toBeNull();
    expect(draw(s, 'path', [[0, 0], [5, 0]])).not.toBeNull();
  });

  it('undo and redo walk back through plant and hardscape edits', () => {
    const s = makeAppStore('edit');
    const base = s.getState().hardscape.length;
    const id = draw(s, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])!;
    s.getState().addInstance('salvia-leucantha', [10, 100]);
    expect(s.getState().hardscape.length).toBe(base + 1);
    expect(s.getState().instances.length).toBe(1);
    s.getState().undo();
    expect(s.getState().instances.length).toBe(0);
    s.getState().undo();
    expect(s.getState().hardscape.length).toBe(base);
    expect(s.getState().selectedElementId).toBeNull();
    s.getState().redo();
    expect(s.getState().hardscape.some((e) => e.id === id)).toBe(true);
    s.getState().redo();
    expect(s.getState().instances.length).toBe(1);
    // A new edit clears the redo stack.
    s.getState().undo();
    s.getState().addInstance('salvia-leucantha', [12, 100]);
    expect(s.getState().history.future.length).toBe(0);
  });

  it('a drag is one undo step and silent updates do not add more', () => {
    const s = makeAppStore('edit');
    const id = draw(s, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])!;
    const steps = s.getState().history.past.length;
    s.getState().beginGesture();
    for (let i = 1; i <= 10; i++) s.getState().setVertex(id, 0, [20 + i * 0.5, 90]);
    expect(s.getState().history.past.length).toBe(steps + 1);
    s.getState().undo();
    expect(s.getState().hardscape.find((e) => e.id === id)!.points[0]).toEqual([20, 90]);
  });

  it('undoing an edit keeps the element selected when it still exists', () => {
    const s = makeAppStore('edit');
    const id = draw(s, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])!;
    s.getState().beginGesture();
    s.getState().moveElementBy(id, 5, 5);
    expect(s.getState().selectedElementId).toBe(id);
    s.getState().undo();
    expect(s.getState().selectedElementId).toBe(id);
    expect(s.getState().hardscape.find((e) => e.id === id)!.points[0]).toEqual([20, 90]);
  });

  it('removing an existing element toggles it instead of deleting it', () => {
    const s = makeAppStore('edit');
    s.getState().deleteElement('driveway');
    expect(s.getState().hardscape.find((e) => e.id === 'driveway')!.removed).toBe(true);
    s.getState().deleteElement('driveway');
    expect(s.getState().hardscape.find((e) => e.id === 'driveway')!.removed).toBe(false);
  });

  it('changing material resets the surface depth to the material default', () => {
    const s = makeAppStore('edit');
    const id = draw(s, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])!;
    s.getState().setElementMaterial(id, 'pavers-sand');
    const el = s.getState().hardscape.find((e) => e.id === id)!;
    expect(el.materialId).toBe('pavers-sand');
    expect(el.depthIn).toBe(2.5);
  });

  it('view mode cannot draw, edit, remove, or undo hardscape', () => {
    const v = makeAppStore('view');
    const before = v.getState().hardscape;
    expect(draw(v, 'patio', [[20, 90], [30, 90], [30, 102], [20, 102]])).toBeNull();
    v.getState().deleteElement('driveway');
    v.getState().updateElement('driveway', { height: 9 });
    v.getState().moveElementBy('driveway', 5, 5);
    v.getState().setVertex('driveway', 0, [9, 9]);
    expect(v.getState().hardscape).toBe(before);
    v.getState().undo();
    v.getState().redo();
    expect(v.getState().hardscape).toBe(before);
  });
});

describe('hydrozones, soil, and settings (M5)', () => {
  it('creates, renames, assigns, and deletes hydrozones with undo', () => {
    const s = makeAppStore('edit');
    const plant = s.getState().addInstance('salvia-leucantha', [30, 90])!;
    const id = s.getState().addHydrozone('Front beds', 'drip')!;
    s.getState().assignHydrozone(plant, id);
    expect(s.getState().instances[0].hydrozoneId).toBe(id);
    s.getState().updateHydrozone(id, { irrigation: 'spray' });
    expect(s.getState().hydrozones[0].irrigation).toBe('spray');
    s.getState().deleteHydrozone(id);
    expect(s.getState().hydrozones.length).toBe(0);
    expect(s.getState().instances[0].hydrozoneId).toBeUndefined();
    s.getState().undo();
    expect(s.getState().hydrozones.length).toBe(1);
    expect(s.getState().instances[0].hydrozoneId).toBe(id);
  });

  it('rejects empty hydrozone names', () => {
    const s = makeAppStore('edit');
    expect(s.getState().addHydrozone('  ', 'drip')).toBeNull();
  });

  it('starts every yard zone on the default loam profile and marks it as an edit once entered', () => {
    const s = makeAppStore('edit');
    const zones = s.getState().site.zones.map((z) => z.id);
    expect(zones.every((z) => s.getState().soilProfiles[z].isDefault === true)).toBe(true);
    s.getState().setSoilProfile(zones[0], { texture: 'clay', drainageInHr: 0.3 });
    expect(s.getState().soilProfiles[zones[0]]).toMatchObject({ texture: 'clay', drainageInHr: 0.3, isDefault: false });
    expect(s.getState().soilProfiles[zones[1]].isDefault).toBe(true);
  });

  it('view mode cannot change hydrozones, rain, soil, or play areas', () => {
    const v = makeAppStore('view');
    expect(v.getState().addHydrozone('Z', 'drip')).toBeNull();
    v.getState().setUseRain(true);
    v.getState().setAutoIrrigation('auto:low', 'none');
    v.getState().setSoilProfile(v.getState().site.zones[0].id, { ph: 5 });
    v.getState().setPlayZone('front_yard', true);
    expect(v.getState().useRain).toBe(false);
    expect(v.getState().autoIrrigation).toEqual({});
    expect(v.getState().soilProfiles[v.getState().site.zones[0].id].ph).toBe(7);
    expect(v.getState().playZones).toEqual({});
  });

  it('the rainfall toggle is undoable', () => {
    const s = makeAppStore('edit');
    s.getState().setUseRain(true);
    expect(s.getState().useRain).toBe(true);
    s.getState().undo();
    expect(s.getState().useRain).toBe(false);
  });
});

describe('scenarios (SC-1, SC-2)', () => {
  const plant = (s: ReturnType<typeof makeAppStore>, id = 'salvia-leucantha', at: [number, number] = [38, 100]) => s.getState().addInstance(id, at)!;

  it('starts with one scenario, active, holding the owner picks and the existing driveway', () => {
    const s = makeAppStore('edit');
    expect(s.getState().scenarios.length).toBe(1);
    expect(s.getState().scenarios[0].name).toBe('Scenario 1');
    expect(s.getState().activeScenarioId).toBe(s.getState().scenarios[0].id);
    expect(s.getState().hardscape.map((e) => e.id)).toEqual(['driveway']);
    expect(Object.keys(s.getState().palette).length).toBe(17);
  });

  it('creates a blank scenario, parks the old one, and switches back without losing anything', () => {
    const s = makeAppStore('edit');
    const first = s.getState().activeScenarioId;
    plant(s);
    s.getState().setUseRain(true);
    const second = s.getState().createScenario('Natives only')!;
    expect(s.getState().activeScenarioId).toBe(second);
    expect(s.getState().instances).toEqual([]);
    expect(s.getState().useRain).toBe(false);
    expect(s.getState().scenarios.map((x) => x.name)).toEqual(['Scenario 1', 'Natives only']);
    plant(s, 'salvia-leucantha', [30, 90]);
    plant(s, 'salvia-leucantha', [34, 96]);
    s.getState().switchScenario(first);
    expect(s.getState().instances.length).toBe(1);
    expect(s.getState().useRain).toBe(true);
    s.getState().switchScenario(second);
    expect(s.getState().instances.length).toBe(2);
    expect(s.getState().useRain).toBe(false);
  });

  it('duplicates a scenario into an independent copy', () => {
    const s = makeAppStore('edit');
    const a = s.getState().activeScenarioId;
    plant(s);
    s.getState().startDrawing('patio');
    [[30, 70], [40, 70], [40, 82], [30, 82]].forEach((p) => s.getState().addDrawPoint(p as [number, number]));
    s.getState().finishDrawing();
    const b = s.getState().createScenario(undefined, a)!;
    expect(s.getState().scenarios.find((x) => x.id === b)!.name).toBe('Scenario 1 copy');
    expect(s.getState().instances.length).toBe(1);
    expect(s.getState().hardscape.length).toBe(2);
    plant(s, 'phormium-tenax', [28, 110]);
    s.getState().deleteElement(s.getState().hardscape[1].id);
    s.getState().switchScenario(a);
    expect(s.getState().instances.length).toBe(1);
    expect(s.getState().hardscape.length).toBe(2); // the source is untouched by edits to the copy
    // Duplicating a scenario that is not active works too.
    const c = s.getState().createScenario('From parked', b)!;
    expect(s.getState().scenarios.find((x) => x.id === c)!.name).toBe('From parked');
    expect(s.getState().instances.length).toBe(2);
  });

  it('renames with trimming and ignores empty names', () => {
    const s = makeAppStore('edit');
    const id = s.getState().activeScenarioId;
    s.getState().renameScenario(id, '  Drought plan  ');
    expect(s.getState().scenarios[0].name).toBe('Drought plan');
    s.getState().renameScenario(id, '   ');
    expect(s.getState().scenarios[0].name).toBe('Drought plan');
  });

  it('deletes scenarios, never the last one, and moves off a deleted active scenario', () => {
    const s = makeAppStore('edit');
    const a = s.getState().activeScenarioId;
    expect(s.getState().deleteScenario(a)).toBe(false);
    plant(s);
    const b = s.getState().createScenario('B')!;
    plant(s, 'salvia-leucantha', [30, 90]);
    plant(s, 'salvia-leucantha', [34, 96]);
    expect(s.getState().deleteScenario(b)).toBe(true); // deleting the active one
    expect(s.getState().activeScenarioId).toBe(a);
    expect(s.getState().instances.length).toBe(1);
    expect(s.getState().scenarios.length).toBe(1);
    expect(s.getState().saved).toEqual({});
    const c = s.getState().createScenario('C')!;
    s.getState().switchScenario(a);
    expect(s.getState().deleteScenario(c)).toBe(true); // deleting a parked one
    expect(s.getState().saved[c]).toBeUndefined();
    expect(s.getState().deleteScenario('nope')).toBe(false);
  });

  it('keeps undo inside one scenario, and clears selection when switching', () => {
    const s = makeAppStore('edit');
    const a = s.getState().activeScenarioId;
    plant(s);
    const b = s.getState().createScenario('B')!;
    expect(s.getState().history.past.length).toBe(0);
    s.getState().undo();
    s.getState().switchScenario(a);
    expect(s.getState().instances.length).toBe(1); // undoing in B did not reach into A
    expect(s.getState().selectedId).toBeNull();
    s.getState().switchScenario(b);
    expect(s.getState().instances.length).toBe(0);
  });

  it('records when a scenario was last changed', async () => {
    const s = makeAppStore('edit');
    const before = s.getState().scenarios[0].modifiedAt;
    await new Promise((r) => setTimeout(r, 5));
    plant(s);
    expect(s.getState().scenarios[0].modifiedAt > before).toBe(true);
  });

  it('exports a scenario and imports it as a new, active scenario with the same plan', () => {
    const s = makeAppStore('edit');
    plant(s);
    plant(s, 'phormium-tenax', [28, 110]);
    s.getState().addHydrozone('Back', 'spray');
    const file = s.getState().exportScenario(s.getState().activeScenarioId)!;
    expect(file.name).toBe('Scenario 1');
    const t = makeAppStore('edit');
    const r = t.getState().importScenarioFile(file.text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(t.getState().scenarios.length).toBe(2);
    expect(t.getState().activeScenarioId).toBe(r.id);
    expect(t.getState().instances).toEqual(s.getState().instances);
    expect(t.getState().hydrozones).toEqual(s.getState().hydrozones);
    expect(t.getState().saved[t.getState().scenarios[0].id].instances).toEqual([]); // the original was parked, not replaced
  });

  it('rejects a bad import without changing anything', () => {
    const s = makeAppStore('edit');
    plant(s);
    const before = JSON.stringify([s.getState().scenarios, s.getState().instances]);
    const r = s.getState().importScenarioFile('{"format":"ashby-scenario/1","name":"x","scenario":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify([s.getState().scenarios, s.getState().instances])).toBe(before);
  });

  it('carries a custom species through export and import, renaming rather than overwriting a different one', () => {
    const a = makeAppStore('edit');
    const mk = (matureHeight: number) => ({ common: 'Backyard Bush', type: 'shrub' as const, origin: 'other' as const, evergreen: true, matureHeight, matureWidth: 4, yearsToMaturity: 3, habit: 'round' as const, sun: 'full' as const, wucols: 'low' as const, bloomMonths: [5], bloomColor: '#ff00ff', pollinatorValue: 'high' as const, groups: [], invasive: false, toxic: false });
    const spA = makeCustomSpecies(mk(4), []);
    if (!spA.ok) throw new Error('bad');
    a.getState().addSpecies(spA.species);
    a.getState().addInstance(spA.species.id, [38, 100]);
    const file = a.getState().exportScenario(a.getState().activeScenarioId)!;

    const same = makeAppStore('edit');
    expect(same.getState().importScenarioFile(file.text).ok).toBe(true);
    expect(same.getState().library.species.filter((x) => x.id === spA.species.id).length).toBe(1);
    expect(same.getState().instances[0].speciesId).toBe(spA.species.id);

    // Same id, different plant: the imported one gets a new id and the plants follow it.
    const other = makeAppStore('edit');
    const spB = makeCustomSpecies(mk(9), []);
    if (!spB.ok) throw new Error('bad');
    other.getState().addSpecies(spB.species);
    expect(spB.species.id).toBe(spA.species.id);
    expect(other.getState().importScenarioFile(file.text).ok).toBe(true);
    const ids = other.getState().library.species.filter((x) => x.common === 'Backyard Bush').map((x) => `${x.id}:${x.matureHeight}`).sort();
    expect(ids).toEqual([`${spA.species.id}-2:4`, `${spA.species.id}:9`].sort());
    expect(other.getState().instances[0].speciesId).toBe(`${spA.species.id}-2`);
    expect(other.getState().palette[`${spA.species.id}-2`]).toBe(true);
  });

  it('fills soil results from an import only where the owner has not entered their own', () => {
    const src = makeAppStore('edit');
    src.getState().setSoilProfile('back_yard', { texture: 'clay', ph: 5.5 });
    src.getState().setSoilProfile('front_yard', { texture: 'sand' });
    src.getState().setPlayZone('front_yard', true);
    const file = src.getState().exportScenario(src.getState().activeScenarioId)!;
    const dest = makeAppStore('edit');
    dest.getState().setSoilProfile('back_yard', { texture: 'silt loam', ph: 7.8 }); // the owner's own result
    dest.getState().importScenarioFile(file.text);
    expect(dest.getState().soilProfiles.back_yard).toMatchObject({ texture: 'silt loam', ph: 7.8 });
    expect(dest.getState().soilProfiles.front_yard).toMatchObject({ texture: 'sand' });
    expect(dest.getState().playZones.front_yard).toBe(true);
  });

  it('restores a saved workspace exactly, and new plants never reuse an id', () => {
    const a = makeAppStore('edit');
    const first = a.getState().activeScenarioId;
    plant(a);
    plant(a, 'phormium-tenax', [28, 110]);
    a.getState().createScenario('Second');
    plant(a, 'salvia-leucantha', [20, 100]);
    a.getState().setSoilProfile('back_yard', { texture: 'clay' });
    a.getState().addShare({ scenarioId: first, token: 'T'.repeat(22), revokeKey: 'k', createdAt: 'c', updatedAt: 'u', hideAddress: true, revoked: false });
    const ws = JSON.parse(JSON.stringify(a.getState().toWorkspace()));

    const b = makeAppStore('edit');
    b.getState().hydrateWorkspace(ws);
    expect(b.getState().scenarios).toEqual(a.getState().scenarios);
    expect(b.getState().activeScenarioId).toBe(a.getState().activeScenarioId);
    expect(b.getState().instances).toEqual(a.getState().instances);
    expect(b.getState().saved).toEqual(a.getState().saved);
    expect(b.getState().soilProfiles.back_yard.texture).toBe('clay');
    expect(b.getState().shares).toEqual(a.getState().shares);
    expect(b.getState().toWorkspace()).toEqual(ws);
    const used = new Set([...b.getState().instances, ...Object.values(b.getState().saved).flatMap((d) => d.instances)].map((i) => i.id));
    const fresh = plant(b, 'salvia-leucantha', [14, 100]);
    expect(used.has(fresh)).toBe(false);
  });

  it('skips damaged scenarios in saved data instead of crashing, and ignores a workspace it cannot use at all', () => {
    const a = makeAppStore('edit');
    plant(a);
    const second = a.getState().createScenario('Second')!;
    plant(a, 'salvia-leucantha', [30, 90]);
    const ws = JSON.parse(JSON.stringify(a.getState().toWorkspace()));
    ws.data[second].instances[0].container = 'barrel'; // the active scenario is damaged
    const b = makeAppStore('edit');
    b.getState().hydrateWorkspace(ws);
    expect(b.getState().scenarios.map((x) => x.name)).toEqual(['Scenario 1']);
    expect(b.getState().instances.length).toBe(1);
    const c = makeAppStore('edit');
    const allBad = JSON.parse(JSON.stringify(ws));
    for (const id of Object.keys(allBad.data)) allBad.data[id].palette = 'nope';
    c.getState().hydrateWorkspace(allBad);
    expect(c.getState().scenarios.length).toBe(1);
    expect(c.getState().instances).toEqual([]);
  });

  it('a viewer ignores a saved workspace, and cannot manage scenarios', () => {
    const owner = makeAppStore('edit');
    plant(owner);
    const ws = owner.getState().toWorkspace();
    const v = makeAppStore('view');
    v.getState().hydrateWorkspace(ws);
    expect(v.getState().instances).toEqual([]);
    expect(v.getState().createScenario('x')).toBeNull();
    expect(v.getState().deleteScenario(v.getState().activeScenarioId)).toBe(false);
    v.getState().switchScenario('anything');
    expect(v.getState().scenarios.length).toBe(1);
  });
});

describe('hardscape persistence, color and duplicate', () => {
  it('keeps a half-drawn path when another tool is picked, but Cancel discards it', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    g().startDrawing('path');
    g().addDrawPoint([10, 90]);
    g().addDrawPoint([20, 95]);
    g().startDrawing('patio');
    expect(g().hardscape.filter((e) => e.type === 'path' && !e.existing)).toHaveLength(1);
    expect(g().drawing?.type).toBe('patio');
    g().addDrawPoint([30, 90]);
    g().setPlacing('x'); // a patio with one point is too short to keep
    expect(g().hardscape.filter((e) => e.type === 'patio' && !e.existing)).toHaveLength(0);
    g().startDrawing('path');
    g().addDrawPoint([10, 100]);
    g().addDrawPoint([20, 100]);
    g().startDrawing(null); // Cancel / Esc
    expect(g().hardscape.filter((e) => e.type === 'path' && !e.existing)).toHaveLength(1);
  });

  it('stores a custom color on an element and clears it', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    g().startDrawing('path');
    g().addDrawPoint([10, 90]);
    g().addDrawPoint([20, 95]);
    const id = g().finishDrawing()!;
    g().updateElement(id, { color: '#aa3300' });
    expect(g().hardscape.find((e) => e.id === id)!.color).toBe('#aa3300');
    g().updateElement(id, { color: undefined });
    expect(g().hardscape.find((e) => e.id === id)!.color).toBeUndefined();
  });

  it('duplicates an element as new work, undoably, keeping its color and shifting nothing when asked', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    g().startDrawing('patio');
    [[20, 90], [30, 90], [30, 102], [20, 102]].forEach((p) => g().addDrawPoint(p as [number, number]));
    const id = g().finishDrawing()!;
    g().updateElement(id, { color: '#336699' });
    const copy = g().duplicateElement(id, [0, 0])!;
    const a = g().hardscape.find((e) => e.id === id)!;
    const b = g().hardscape.find((e) => e.id === copy)!;
    expect(copy).not.toBe(id);
    expect(b.points).toEqual(a.points);
    expect(b.color).toBe('#336699');
    expect(b.existing).toBe(false);
    expect(g().selectedElementId).toBe(copy);
    g().undo();
    expect(g().hardscape.some((e) => e.id === copy)).toBe(false);
    const view = makeAppStore('view');
    expect(view.getState().duplicateElement('anything')).toBeNull();
  });

  it('copies the existing driveway as new, removable work without its keep-clear flag', () => {
    const s = makeAppStore('edit');
    const g = () => s.getState();
    const drive = g().hardscape.find((e) => e.keepClear)!;
    const copyId = g().duplicateElement(drive.id)!;
    const copy = g().hardscape.find((e) => e.id === copyId)!;
    expect(copy.keepClear).toBeUndefined();
    expect(copy.existing).toBe(false);
  });
});
