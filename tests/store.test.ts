import { describe, expect, it } from 'vitest';
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
