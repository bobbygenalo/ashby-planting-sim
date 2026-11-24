import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { CROPS } from '../src/data/cropLibrary';
import { activeCrop, cropFootprintFt, cropInsetFt, cropPositions, cropSpacingFt, cropSpots, cropStage, defaultCropPlan } from '../src/engine/crops';
import { distanceToSegment, pointInPolygon } from '../src/engine/geometry';
import type { CropCfg } from '../src/engine/types';

const cfg = (engineRaw as unknown as { crops: CropCfg }).crops;
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const byId = (id: string) => CROPS.find((c) => c.id === id)!;

describe('raised-bed crops', () => {
  it('turns each annual over: sown small, full when harvested, spent, then pulled, then bare until sown again', () => {
    const t = byId('tomato');
    expect(cropStage(t, 4, cfg).phase).toBe('bare');
    const may = cropStage(t, 5, cfg), jul = cropStage(t, 7, cfg), oct = cropStage(t, 10, cfg);
    expect(may.phase).toBe('growing');
    expect(may.size).toBeCloseTo(cfg.seedlingFraction);
    expect(cropStage(t, 6, cfg).size).toBeGreaterThan(may.size);
    expect(jul).toMatchObject({ phase: 'harvest', size: 1, produce: true });
    expect(oct.phase).toBe('spent');
    expect(oct.fade).toBe(1);
    expect(cropStage(t, 11, cfg).phase).toBe('bare');
  });

  it('cuts strawberries back in winter and regrows them in spring', () => {
    const s = byId('strawberry');
    expect(cropStage(s, 1, cfg).phase).toBe('dormant');
    expect(cropStage(s, 2, cfg).size).toBeCloseTo(cfg.regrowFraction);
    expect(cropStage(s, 5, cfg)).toMatchObject({ size: 1, produce: true });
    expect(cropStage(s, 9, cfg).produce).toBe(false);
  });

  it('keeps the two seasons from overlapping, so a bed holds one crop at a time and is never empty for long', () => {
    const cool = CROPS.filter((c) => c.season === 'cool'), warm = CROPS.filter((c) => c.season === 'warm');
    for (const c of cool) for (const m of months) if (!cfg.seasons.cool.includes(m)) expect(cropStage(c, m, cfg).phase, `${c.id} month ${m}`).toBe('bare');
    for (const c of warm) for (const m of months) if (!cfg.seasons.warm.includes(m)) expect(cropStage(c, m, cfg).phase, `${c.id} month ${m}`).toBe('bare');
    for (const id of ['lettuce', 'tomato']) expect(months.filter((m) => cropStage(byId(id), m, cfg).phase !== 'bare').length).toBeGreaterThanOrEqual(5);
    const plan = { cool: 'kale', warm: 'pepper' };
    const present = months.filter((m) => activeCrop(plan, CROPS, m, cfg));
    expect(present.length).toBeGreaterThanOrEqual(9);
  });

  it('has sensible months and a default rotation with a cool and a warm crop that varies by bed', () => {
    for (const c of CROPS) {
      for (const m of [c.sowMonth, c.harvestStart, c.endMonth]) expect(m >= 1 && m <= 12).toBe(true);
      expect(c.heightFt).toBeGreaterThan(0);
      expect(c.spacingFt).toBeGreaterThan(0);
    }
    const plans = Array.from({ length: 12 }, (_, i) => defaultCropPlan(`bed-${i}`, CROPS, i));
    for (const p of plans) {
      expect(byId(p.cool).season).toBe('cool');
      expect(byId(p.warm).season).toBe('warm');
    }
    expect(new Set(plans.map((p) => p.warm)).size).toBeGreaterThan(2);
  });

  it('plants a grid inside the bed, at spacing, and never more than the cap', () => {
    const bed: [number, number][] = [[10, 20], [14, 20], [14, 32], [10, 32]];
    const spots = cropPositions(bed, 1, cfg);
    expect(spots.length).toBeGreaterThan(10);
    for (const [x, y] of spots) {
      expect(pointInPolygon(x, y, bed)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(10 + cfg.insetFt - 1e-6);
      expect(x).toBeLessThanOrEqual(14 - cfg.insetFt + 1e-6);
    }
    expect(cropPositions([[0, 0], [40, 0], [40, 40], [0, 40]], 0.2, cfg).length).toBeLessThanOrEqual(cfg.maxPlants);
    expect(cropPositions([[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]], 1, cfg)).toEqual([]);
  });
});

describe('how far apart plants stand in a raised bed', () => {
  const crops = CROPS;
  const rect = (w: number, d: number): [number, number][] => [[0, 0], [w, 0], [w, d], [0, d]];
  // Extension guides' in-row spacing in feet (carrots 3 to 6 in, lettuce 6 to 12 in, broccoli 15 to 24 in, and so on): the
  // data should sit inside these, being general estimates, so a typo cannot pack or strand a crop.
  const RANGE: Record<string, [number, number]> = {
    carrot: [0.25, 0.5], lettuce: [0.5, 1], spinach: [0.25, 0.8], kale: [1, 2], broccoli: [1.25, 2], peas: [0.2, 0.5], tomato: [1.5, 3],
    pepper: [1, 2], eggplant: [1.5, 2.5], zucchini: [2, 3], cucumber: [1, 2], beans: [0.3, 0.8], basil: [0.5, 1.25], strawberry: [1, 1.5],
  };

  it('keeps every crop\'s recommended spacing in the data within what extension guides give', () => {
    for (const c of crops) {
      expect(RANGE[c.id], c.id).toBeDefined();
      expect(c.spacingFt, c.id).toBeGreaterThanOrEqual(RANGE[c.id][0]);
      expect(c.spacingFt, c.id).toBeLessThanOrEqual(RANGE[c.id][1]);
    }
  });

  it('never sets plants closer than the recommended spacing, nor closer than they are drawn', () => {
    for (const c of crops) {
      const f = cropFootprintFt(c, cfg);
      const sp = cropSpacingFt(c, cfg);
      expect(sp, c.id).toBeGreaterThanOrEqual(c.spacingFt);
      expect(sp, c.id).toBeGreaterThanOrEqual(f.canopy * cfg.canopyShare - 1e-9);
      expect(sp, c.id).toBeGreaterThanOrEqual(f.produce * cfg.produceGapShare - 1e-9); // a gap round the drawn produce
    }
  });

  it('spaces carrots wider than the drawn roots, which is why the 3 by 6 bed no longer looks like a solid block of orange', () => {
    const carrot = crops.find((c) => c.id === 'carrot')!;
    const f = cropFootprintFt(carrot, cfg);
    expect(f.produce).toBeGreaterThan(carrot.spacingFt); // drawn wider than the guide spacing: that was the overlap
    expect(cropSpacingFt(carrot, cfg)).toBeGreaterThan(f.produce);
    const spots = cropSpots(rect(3, 6), carrot, cfg);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThanOrEqual(f.produce + 1e-6);
    }
  });

  it('keeps every plant its own width off the walls, in a rectangle and in an L, with equal gaps in both directions', () => {
    const L: [number, number][] = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    for (const c of crops) {
      for (const poly of [rect(3, 6), rect(6, 6), L]) {
        const inset = cropInsetFt(c, cfg);
        expect(inset).toBeGreaterThanOrEqual(cfg.insetFt);
        const sp = cropSpots(poly, c, cfg);
        for (const [x, y] of sp) {
          expect(pointInPolygon(x, y, poly), c.id).toBe(true);
          let d = Infinity;
          poly.forEach((p, i) => { d = Math.min(d, distanceToSegment([x, y], p, poly[(i + 1) % poly.length]).dist); });
          expect(d, c.id).toBeGreaterThanOrEqual(inset * 0.5 - 1e-9);
        }
        // a grid: the same spacing along rows and columns
        const xs = [...new Set(sp.map((q) => q[0].toFixed(4)))].map(Number).sort((a, b) => a - b);
        for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeCloseTo(xs[1] - xs[0], 3);
      }
    }
  });

  it('puts a big crop in a 3 by 3 bed one to a few at a time, and fills a bed with a small crop', () => {
    const tomato = crops.find((c) => c.id === 'tomato')!, lettuce = crops.find((c) => c.id === 'lettuce')!;
    expect(cropSpots(rect(3, 3), tomato, cfg).length).toBeLessThanOrEqual(4);
    expect(cropSpots(rect(3, 3), lettuce, cfg).length).toBeGreaterThanOrEqual(4);
  });
});
