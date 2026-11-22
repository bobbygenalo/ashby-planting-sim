import { describe, expect, it } from 'vitest';
import { WORKSPACE_KEY, loadWorkspace, saveWorkspace, type KeyValueStorage } from '../src/engine/scenario';
import { makeAppStore } from '../src/store/store';

const memory = (): KeyValueStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe('autosave and restore (SC-2)', () => {
  it('a session\'s work survives a reload: save, then a fresh app restores it all', () => {
    const storage = memory();
    const first = makeAppStore('edit');
    const g = () => first.getState();
    g().setPaletteSpecies('salvia-clevelandii', true);
    g().addInstance('salvia-clevelandii', [38, 100]);
    g().startDrawing('patio');
    [[30, 70], [40, 70], [40, 82], [30, 82]].forEach((p) => g().addDrawPoint(p as [number, number]));
    g().finishDrawing();
    g().createScenario('Second idea');
    g().addInstance('salvia-leucantha', [20, 100]);
    g().renameScenario(g().scenarios[0].id, 'Main plan');
    g().setSoilProfile('back_yard', { texture: 'clay' });
    expect(saveWorkspace(storage, g().toWorkspace())).toEqual({ ok: true });

    // "Reload": a brand new store reads what was saved.
    const second = makeAppStore('edit');
    const ws = loadWorkspace(storage);
    expect(ws).not.toBeNull();
    second.getState().hydrateWorkspace(ws!);
    expect(second.getState().scenarios.map((s) => s.name)).toEqual(['Main plan', 'Second idea']);
    expect(second.getState().activeScenarioId).toBe(g().activeScenarioId);
    expect(second.getState().instances).toEqual(g().instances);
    expect(second.getState().soilProfiles.back_yard.texture).toBe('clay');
    second.getState().switchScenario(second.getState().scenarios[0].id);
    expect(second.getState().instances.map((i) => i.speciesId)).toEqual(['salvia-clevelandii']);
    expect(second.getState().hardscape.length).toBe(2);
  });

  it('a damaged save is ignored and the app starts fresh rather than breaking', () => {
    const storage = memory();
    storage.setItem(WORKSPACE_KEY, '{"format":"ashby-workspace/1","scenarios":[{"id":"a","name":"A"}],"data":{"a":{"palette":5}},"activeId":"a"}');
    const ws = loadWorkspace(storage);
    const store = makeAppStore('edit');
    if (ws) store.getState().hydrateWorkspace(ws);
    expect(store.getState().scenarios.length).toBe(1);
    expect(store.getState().scenarios[0].name).toBe('Scenario 1');
    expect(store.getState().instances).toEqual([]);
  });

  it('saves a workspace that carries the share links, so they can still be turned off after a reload', () => {
    const storage = memory();
    const s = makeAppStore('edit');
    s.getState().addShare({ scenarioId: s.getState().activeScenarioId, token: 'K'.repeat(22), revokeKey: 'secret-key', createdAt: 'c', updatedAt: 'u', blurLocation: false, revoked: false });
    saveWorkspace(storage, s.getState().toWorkspace());
    const t = makeAppStore('edit');
    t.getState().hydrateWorkspace(loadWorkspace(storage)!);
    expect(t.getState().shares[0].revokeKey).toBe('secret-key');
  });
});
