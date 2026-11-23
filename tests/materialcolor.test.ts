import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { dropMappedColors, elementColor } from '../src/engine/hardscape';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const engine = engineRaw as unknown as EngineConfig;
const mats = ((materialsRaw as unknown as { materials?: Material[] }).materials ?? (materialsRaw as unknown as Material[]));
const hs = engine.hardscape;
const el = (materialId: string, color?: string): HardscapeElement => ({ id: 'x', type: 'patio', points: [[0, 0], [1, 0], [1, 1]], materialId, height: 0, depthIn: 4, width: 0, existing: false, ...(color ? { color } : {}) });

describe('material colors and overrides', () => {
  it('shows the color mapped to the material, and only an owner-set color overrides it', () => {
    expect(elementColor(el('concrete'), mats, hs)).toBe(hs.materialColors.concrete);
    expect(elementColor(el('lawn'), mats, hs)).toBe(hs.materialColors.lawn);
    expect(elementColor(el('concrete', '#123456'), mats, hs)).toBe('#123456');
  });

  it('falls back to the material\'s own color where the map has none, and then to grey', () => {
    const wall = mats.find((m) => m.id === 'cmu-wall')!;
    expect(hs.materialColors['cmu-wall']).toBeUndefined();
    expect(elementColor(el('cmu-wall'), mats, hs)).toBe(wall.color);
    expect(elementColor(el('nothing'), mats, hs)).toBe('#aaaaaa');
  });

  it('maps every ground material, and only materials that exist', () => {
    for (const m of mats.filter((x) => ['paving', 'loose', 'planting', 'turf', 'deck'].includes(x.category))) expect(hs.materialColors[m.id], m.id).toBeTruthy();
    for (const id of Object.keys(hs.materialColors)) expect(mats.some((m) => m.id === id), id).toBe(true);
  });

  it('gives the new material\'s color when the material changes, dropping an override', () => {
    const s = makeAppStore('edit');
    const id = 'mc-1';
    s.setState({ hardscape: [...s.getState().hardscape, { ...el('concrete', '#ff00ff'), id }] });
    expect(elementColor(s.getState().hardscape.find((e) => e.id === id)!, s.getState().materials, hs)).toBe('#ff00ff');
    s.getState().setElementMaterial(id, 'lawn');
    const after = s.getState().hardscape.find((e) => e.id === id)!;
    expect(after.materialId).toBe('lawn');
    expect(after.color).toBeUndefined();
    expect(elementColor(after, s.getState().materials, hs)).toBe(hs.materialColors.lawn);
    // and a plain element follows the material too
    s.setState({ hardscape: [...s.getState().hardscape, { ...el('concrete'), id: 'mc-2' }] });
    s.getState().setElementMaterial('mc-2', 'gravel');
    expect(elementColor(s.getState().hardscape.find((e) => e.id === 'mc-2')!, s.getState().materials, hs)).toBe(hs.materialColors.gravel);
  });

  it('lets the owner set a color on a new material afterwards, and take it back', () => {
    const s = makeAppStore('edit');
    s.setState({ hardscape: [...s.getState().hardscape, { ...el('lawn'), id: 'mc-3' }] });
    s.getState().updateElement('mc-3', { color: '#00ffaa' });
    expect(elementColor(s.getState().hardscape.find((e) => e.id === 'mc-3')!, s.getState().materials, hs)).toBe('#00ffaa');
    s.getState().updateElement('mc-3', { color: undefined });
    expect(elementColor(s.getState().hardscape.find((e) => e.id === 'mc-3')!, s.getState().materials, hs)).toBe(hs.materialColors.lawn);
  });

  it('drops a stamped color that is only the mapped one, from older plans, and keeps a real override', () => {
    const list = [el('concrete', hs.materialColors.concrete.toUpperCase()), el('concrete', '#123456'), el('lawn')];
    const out = dropMappedColors(list, hs);
    expect(out[0].color).toBeUndefined();
    expect(out[1].color).toBe('#123456');
    expect(out[2].color).toBeUndefined();
    expect(list[0].color).toBeTruthy(); // the input is left alone
  });
});
