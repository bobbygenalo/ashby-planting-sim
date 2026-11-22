import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { elementAt } from '../src/engine/hardscape';
import type { EngineConfig, HardscapeElement, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const cfg = (engineRaw as unknown as EngineConfig).hardscape;
const lib = speciesRaw as unknown as SpeciesLibrary;
const rect = (id: string, type: HardscapeElement['type'], x: number, y: number, w: number, d: number): HardscapeElement => ({
  id, type, points: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], materialId: 'concrete', height: 0, depthIn: 3, width: 0, existing: false,
});

describe('copying elements by Option-drag', () => {
  it('finds the element drawn on top at a spot, whatever its type', () => {
    const lawn = rect('l', 'lawn', 0, 0, 20, 20), patio = rect('p', 'patio', 5, 5, 10, 10), table = rect('t', 'table', 8, 8, 4, 4);
    const all = [lawn, patio, table];
    expect(elementAt(all, [10, 10], cfg)?.id).toBe('t'); // the table stands on the patio, which lies on the lawn
    expect(elementAt(all, [6, 6], cfg)?.id).toBe('p');
    expect(elementAt(all, [2, 2], cfg)?.id).toBe('l');
    expect(elementAt(all, [30, 30], cfg)).toBeUndefined();
    expect(elementAt([{ ...patio, removed: true }], [10, 10], cfg)).toBeUndefined();
    // two of the same type: the later one is on top
    expect(elementAt([rect('a', 'bed', 0, 0, 10, 10), rect('b', 'bed', 0, 0, 10, 10)], [5, 5], cfg)?.id).toBe('b');
  });

  it('copies any hardscape element in place so the copy can be dragged, and undo removes it', () => {
    const s = makeAppStore('edit');
    for (const type of ['patio', 'lawn', 'bed', 'gravel', 'raisedBed'] as const) {
      s.getState().startDrawing(type);
      for (const p of [[20, 90], [26, 90], [26, 96], [20, 96]] as [number, number][]) s.getState().addDrawPoint(p);
      const id = s.getState().finishDrawing()!;
      const before = s.getState().hardscape.length;
      const copy = s.getState().duplicateElement(id, [0, 0])!;
      expect(s.getState().hardscape.length).toBe(before + 1);
      expect(s.getState().hardscape.find((e) => e.id === copy)!.points).toEqual(s.getState().hardscape.find((e) => e.id === id)!.points);
      expect(s.getState().selectedElementId).toBe(copy);
      s.getState().undo();
      expect(s.getState().hardscape.length).toBe(before);
    }
  });

  it('copies a plant in place, selects the copy, and undo removes it', () => {
    const s = makeAppStore('edit');
    const sp = lib.species[0];
    s.getState().addInstance(sp.id, [30, 100]);
    const id = s.getState().instances[0].id;
    const copy = s.getState().duplicateInstance(id, [0, 0])!;
    expect(copy).toBeTruthy();
    expect(s.getState().instances).toHaveLength(2);
    expect(s.getState().instances.find((i) => i.id === copy)!.position).toEqual([30, 100]);
    expect(s.getState().instances.find((i) => i.id === copy)!.speciesId).toBe(sp.id);
    expect(s.getState().selectedId).toBe(copy);
    s.getState().undo();
    expect(s.getState().instances).toHaveLength(1);
    // the Duplicate button still offsets it 2 ft east
    const next = s.getState().duplicateInstance(id)!;
    expect(s.getState().instances.find((i) => i.id === next)!.position).toEqual([32, 100]);
    const v = makeAppStore('view');
    expect(v.getState().duplicateInstance('nope')).toBeNull();
  });
});
