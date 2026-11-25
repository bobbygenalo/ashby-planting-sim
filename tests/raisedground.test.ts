import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { buildLifeWorld, isInside, LifeSim } from '../src/engine/life';
import { pointInPolygon } from '../src/engine/geometry';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const world = buildLifeWorld({ site, structures: activeStructures(site, { aduEnabled: true }), hardscape: site.hardscape as HardscapeElement[], materials: materialsRaw as unknown as Material[], plants: [], month: 4, engine });

describe('people stand on raised ground', () => {
  it('knows the porch floor and the stoop', () => {
    const ids = world.raised.map((r) => r.top).sort();
    expect(ids).toContain(1.25);
    expect(ids).toContain(0.75);
  });
  it('keeps the feet at the height of the ground under them, easing between levels', () => {
    const sim = new LifeSim(world, engine.life, 3, { people: 12, dogs: 2, bees: false });
    let onRaised = 0, maxJump = 0;
    const last = new Map<number, number>();
    for (let t = 0; t < 1800; t += 0.1) {
      sim.step(0.1);
      sim.walkers.forEach((w, i) => {
        if (isInside(w)) return;
        const target = sim.groundAt(w.x, w.y);
        if (target > 0 && pointInPolygon(w.x, w.y, world.raised.find((r) => r.top === target)!.poly) && w.gz >= target - 0.01) onRaised++;
        maxJump = Math.max(maxJump, Math.abs(w.gz - (last.get(i) ?? w.gz)));
        last.set(i, w.gz);
        expect(w.gz).toBeLessThanOrEqual(1.25 + 1e-6);
      });
    }
    expect(onRaised).toBeGreaterThan(0);
    expect(maxJump).toBeLessThanOrEqual(engine.life.people.stepRiseFtS * 0.1 + 1e-6);
  });
});

describe('the back stoops', () => {
  const el = (id: string) => (site.hardscape as HardscapeElement[]).find((e) => e.id === id)!;
  const box = (id: string) => { const xs = el(id).points.map((p) => p[0]), ys = el(id).points.map((p) => p[1]); return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), cx: (Math.max(...xs) + Math.min(...xs)) / 2, y0: Math.min(...ys) }; };
  it('has a 15 by 3 ft stoop centered on the sliding door', () => {
    const b = box('stoop-slider');
    expect(b.w).toBeCloseTo(15, 6); expect(b.d).toBeCloseTo(3, 6);
    const slider = site.openings!.find((o) => o.id === 'rear-slider')!;
    expect(b.cx).toBeCloseTo(slider.at[0], 6);
  });
  it('has a 6 by 5 ft kitchen stoop at the kitchen door with a step down toward the yard', () => {
    const b = box('stoop-kitchen');
    expect(b.w).toBeCloseTo(6, 6); expect(b.d).toBeCloseTo(5, 6);
    const door = site.openings!.find((o) => o.id === 'back-door')!;
    expect(Math.abs(b.cx - door.at[0])).toBeLessThan(3); // under the door
    const step = box('stoop-kitchen-step');
    expect(step.y0).toBeCloseTo(b.y0 + b.d, 6);
    expect(el('stoop-kitchen-step').height!).toBeLessThan(el('stoop-kitchen').height!);
  });
  it('stands clear of every building', () => {
    for (const id of ['stoop-slider', 'stoop-kitchen', 'stoop-kitchen-step']) {
      const xs = el(id).points.map((p) => p[0]), ys = el(id).points.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs) + 0.05, Math.max(...xs) - 0.05, Math.min(...ys) + 0.05, Math.max(...ys) - 0.05];
      const inner = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
      for (const s of site.structures.filter((x) => !x.open)) for (const [x, y] of inner) expect(pointInPolygon(x, y, s.footprint), `${id} in ${s.id}`).toBe(false);
    }
  });
});
