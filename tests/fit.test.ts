import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import { fitDistance, fitPose, fitSphere, fitZoom, selectionBox } from '../src/engine/fit';
import { placedPlants } from '../src/engine/growth';
import { emptyScenarioData } from '../src/engine/scenario';
import { loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, PlantInstance, SpeciesLibrary } from '../src/engine/types';
import { isFitKey } from '../src/ui/shortcuts';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const site = loadSite(siteRaw);
const fit = engine.scene.fit;
const key = (k: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...o });

const apple: PlantInstance = { id: 'a', speciesId: 'malus-mutsu', position: [30, 90], plantedMonth: 0, container: '15gal', existing: false };
const bed: HardscapeElement = { id: 'b', type: 'raisedBed', points: [[10, 80], [16, 80], [16, 83], [10, 83]], materialId: 'cedar', height: 1.5, depthIn: 0, width: 0, existing: false };
const patio: HardscapeElement = { id: 'p', type: 'patio', points: [[20, 70], [30, 70], [30, 80], [20, 80]], materialId: 'concrete', height: 0, depthIn: 4, width: 0, existing: false };
const plants = (month: number) => placedPlants([apple], emptyScenarioData(site).palette, lib.species, month, engine.growth);
const none = { selectedId: null, selectedElementId: null, hive: null, hiveSelected: false };
const args = (over: Record<string, unknown>, month = 120) => ({ plants: plants(month), elements: [bed, patio], hardscapeCfg: engine.hardscape, ...none, ...over });

describe('F frames the selection', () => {
  it('is the F key on its own', () => {
    expect(isFitKey(key('f'))).toBe(true);
    expect(isFitKey(key('F'))).toBe(true);
    for (const o of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) expect(isFitKey(key('f', o))).toBe(false);
    expect(isFitKey(key('g'))).toBe(false);
  });

  it('boxes a plant at the size it has now, an element by its outline and height, and the hive', () => {
    const young = selectionBox(args({ selectedId: 'a' }, 0))!, old = selectionBox(args({ selectedId: 'a' }, 360))!;
    expect(old.maxX - old.minX).toBeGreaterThan(young.maxX - young.minX);
    expect(old.maxZ).toBeGreaterThan(young.maxZ);
    expect((old.minX + old.maxX) / 2).toBeCloseTo(30, 6);
    const b = selectionBox(args({ selectedElementId: 'b' }))!;
    expect([b.minX, b.maxX, b.minY, b.maxY, b.maxZ]).toEqual([10, 16, 80, 83, 1.5]);
    expect(selectionBox(args({ selectedElementId: 'p' }))!.maxZ).toBeGreaterThan(0); // a flat patio still has a little height
    const h = selectionBox(args({ hive: [5, 120], hiveSelected: true }))!;
    expect((h.minX + h.maxX) / 2).toBeCloseTo(5, 6);
  });

  it('boxes nothing when nothing is selected or the thing is gone', () => {
    expect(selectionBox(args({}))).toBeNull();
    expect(selectionBox(args({ selectedId: 'nope' }))).toBeNull();
    expect(selectionBox(args({ selectedElementId: 'nope' }))).toBeNull();
    expect(selectionBox(args({ hive: null, hiveSelected: true }))).toBeNull();
  });

  it('never frames closer than the minimum radius, and wraps a big thing whole', () => {
    const small = fitSphere({ minX: 1, maxX: 1.5, minY: 1, maxY: 1.5, maxZ: 0.3 }, fit);
    expect(small.radius).toBe(fit.minRadiusFt);
    const big = fitSphere({ minX: 0, maxX: 40, minY: 0, maxY: 30, maxZ: 10 }, fit);
    expect(big.radius).toBeCloseTo(Math.hypot(40, 30, 10) / 2, 6);
    expect(big.center).toEqual([20, 15, 5]);
  });

  it('puts the camera far enough that the sphere fits across the narrower field of view', () => {
    const wide = fitDistance(10, 48, 2, 1.5), tall = fitDistance(10, 48, 0.5, 1.5);
    expect(tall).toBeGreaterThan(wide); // a tall, narrow window needs more distance
    // at that distance the sphere (times the margin) just fills the view across the narrower angle
    const v = (48 * Math.PI) / 180;
    expect(wide * Math.sin(v / 2)).toBeCloseTo(10 * 1.5, 6);
    expect(fitDistance(20, 48, 1.5, 1.5)).toBeCloseTo(2 * fitDistance(10, 48, 1.5, 1.5), 6);
  });

  it('moves the camera along its own line of sight, to the sphere, without turning it', () => {
    const cam: [number, number, number] = [10, 30, -20], target: [number, number, number] = [10, 0, -60];
    const sphere = { center: [50, 2, -80] as [number, number, number], radius: 5 };
    const p = fitPose(cam, target, sphere, 25);
    expect(p.target).toEqual(sphere.center);
    const dir = (a: number[], b: number[]) => { const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; const l = Math.hypot(...d); return d.map((v) => v / l); };
    const before = dir(cam, target), after = dir(p.position, p.target);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 9);
    expect(Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2])).toBeCloseTo(25, 9);
  });

  it('zooms a top-down camera so the thing fills the view with the margin', () => {
    expect(fitZoom(10, 60, 100, 1.5)).toBeCloseTo(60 / 15, 9);
    expect(fitZoom(10, 100, 40, 1.5)).toBeCloseTo(40 / 15, 9);
    expect(fitZoom(4, 60, 100, 1.5)).toBeGreaterThan(fitZoom(10, 60, 100, 1.5));
  });
});
