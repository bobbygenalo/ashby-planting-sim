import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { CROPS } from '../src/data/cropLibrary';
import { activeCrop, cropPositions, cropStage, defaultCropPlan } from '../src/engine/crops';
import { pointInPolygon } from '../src/engine/geometry';
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
