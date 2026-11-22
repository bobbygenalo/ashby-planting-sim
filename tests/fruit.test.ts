import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { fruitPositions, fruitState, monthRange, seedFromId, sizeFraction } from '../src/engine/fruit';
import { isLeafOff } from '../src/engine/growth';
import type { EngineConfig, Species, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.fruit;
const lib = speciesRaw as unknown as SpeciesLibrary;
const sp = (id: string): Species => lib.species.find((s) => s.id === id)!;
const grown = (s: Species, fraction: number) => ({ planted: true, height: s.matureHeight * fraction, width: s.matureWidth * fraction });

describe('fruit data', () => {
  const fruiting = lib.species.filter((s) => s.fruit);

  it('covers the edible fruiting trees: apples, olives, lemon, persimmon and pineapple guava', () => {
    expect(fruiting.map((s) => s.id).sort()).toEqual([
      'citrus-meyer-lemon', 'diospyros-kaki-hachiya', 'feijoa-sellowiana', 'malus-mutsu', 'malus-pink-pearl', 'olea-arbequina', 'olea-frantoio',
    ]);
    expect(fruiting.every((s) => s.type === 'edible')).toBe(true);
  });

  it('has sane months, sizes, colors and counts', () => {
    for (const s of fruiting) {
      const f = s.fruit!;
      expect(f.ripeMonths.length).toBeGreaterThan(0);
      for (const m of [...f.ripeMonths, ...(f.unripeMonths ?? [])]) expect(m >= 1 && m <= 12).toBe(true);
      expect((f.unripeMonths ?? []).filter((m) => f.ripeMonths.includes(m))).toEqual([]);
      expect(f.diameterFt).toBeGreaterThan(0);
      expect(f.diameterFt).toBeLessThan(0.5);
      expect(f.count).toBeGreaterThan(0);
      expect(f.ripeColor).toMatch(/^#[0-9a-f]{6}$/i);
      if (f.unripeColor) expect(f.unripeColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('when fruit shows', () => {
  const apple = sp('malus-pink-pearl'); // ripe Aug to Sep, green May to Jul

  it('shows nothing on plants without fruit data, or before planting', () => {
    expect(fruitState(sp('rosmarinus-officinalis'), grown(sp('rosmarinus-officinalis'), 1), 9, cfg)).toBeNull();
    expect(fruitState(apple, { planted: false, height: 0, width: 0 }, 9, cfg)).toBeNull();
  });

  it('waits until the plant is big enough, then shows more as it grows', () => {
    expect(fruitState(apple, grown(apple, cfg.minSizeFraction - 0.05), 9, cfg)).toBeNull();
    const first = fruitState(apple, grown(apple, cfg.minSizeFraction + 0.001), 9, cfg)!;
    const mid = fruitState(apple, grown(apple, 0.8), 9, cfg)!;
    const full = fruitState(apple, grown(apple, 1), 9, cfg)!;
    expect(first.count).toBeLessThan(mid.count);
    expect(mid.count).toBeLessThan(full.count);
    expect(full.count).toBe(apple.fruit!.count);
    expect(first.count).toBeGreaterThanOrEqual(1);
  });

  it('is green and smaller while unripe, full color when ripe, and absent out of season', () => {
    const ripe = fruitState(apple, grown(apple, 1), 9, cfg)!;
    const green = fruitState(apple, grown(apple, 1), 6, cfg)!;
    expect(ripe.phase).toBe('ripe');
    expect(ripe.color).toBe(apple.fruit!.ripeColor);
    expect(green.phase).toBe('unripe');
    expect(green.color).toBe(apple.fruit!.unripeColor);
    expect(green.diameterFt).toBeLessThan(ripe.diameterFt);
    expect(fruitState(apple, grown(apple, 1), 1, cfg)).toBeNull();
    expect(ripe.diameterFt).toBeCloseTo(apple.fruit!.diameterFt * cfg.displayScale, 9);
    const olive = sp('olea-arbequina');
    expect(fruitState(olive, grown(olive, 1), 12, cfg)!.diameterFt).toBe(cfg.minDisplayDiameterFt); // tiny fruit stays visible
  });

  it('draws olives and lemons as ovals and apples as spheres', () => {
    expect(fruitState(sp('malus-mutsu'), grown(sp('malus-mutsu'), 1), 10, cfg)!.aspect).toBe(1);
    expect(fruitState(sp('olea-arbequina'), grown(sp('olea-arbequina'), 1), 12, cfg)!.aspect).toBeGreaterThan(1);
    expect(fruitState(sp('citrus-meyer-lemon'), grown(sp('citrus-meyer-lemon'), 1), 1, cfg)!.aspect).toBeGreaterThan(1);
  });

  it('keeps persimmons on the bare tree after the leaves drop', () => {
    const p = sp('diospyros-kaki-hachiya');
    expect(isLeafOff(p, 12)).toBe(true);
    expect(fruitState(p, grown(p, 1), 12, cfg)).not.toBeNull();
  });

  it('measures how grown a plant is by its smaller dimension', () => {
    expect(sizeFraction(apple, { planted: true, height: apple.matureHeight, width: apple.matureWidth / 2 })).toBeCloseTo(0.5, 9);
    expect(sizeFraction(apple, { planted: true, height: apple.matureHeight * 2, width: apple.matureWidth * 2 })).toBe(1);
  });

  it('never shows more than the maximum count', () => {
    const big = { ...apple, fruit: { ...apple.fruit!, count: 5000 } };
    expect(fruitState(big, grown(big, 1), 9, cfg)!.count).toBe(cfg.maxCount);
  });
});

describe('where fruit hangs', () => {
  const r = 5, base = 2, canopyH = 10;

  it('puts every fruit on or inside the canopy, between its base and top', () => {
    for (const habit of ['round', 'vase', 'columnar', 'spreading'] as const) {
      const pts = fruitPositions(habit, r, base, canopyH, 60, 7, cfg);
      expect(pts).toHaveLength(60);
      for (const [x, y, z] of pts) {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(r + 1e-9);
        expect(z).toBeGreaterThanOrEqual(base - 1e-9);
        expect(z).toBeLessThanOrEqual(base + canopyH + 1e-9);
      }
    }
  });

  it('follows the canopy shape: a round tree is widest in the middle, a vase widest at the top', () => {
    const widest = (habit: 'round' | 'vase', lo: number, hi: number) => {
      const pts = fruitPositions(habit, r, base, canopyH, 400, 3, cfg).filter(([, , z]) => z >= base + lo * canopyH && z <= base + hi * canopyH);
      return Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
    };
    expect(widest('round', 0.45, 0.55)).toBeGreaterThan(widest('round', 0.2, 0.3));
    expect(widest('round', 0.45, 0.55)).toBeGreaterThan(widest('round', 0.88, 0.95));
    expect(widest('vase', 0.85, 0.95)).toBeGreaterThan(widest('vase', 0.2, 0.3));
  });

  it('spreads fruit all the way around, and is the same for the same seed', () => {
    const a = fruitPositions('round', r, base, canopyH, 40, 11, cfg);
    expect(fruitPositions('round', r, base, canopyH, 40, 11, cfg)).toEqual(a);
    expect(fruitPositions('round', r, base, canopyH, 40, 12, cfg)).not.toEqual(a);
    const quadrants = new Set(a.map(([x, y]) => `${Math.sign(x)}${Math.sign(y)}`));
    expect(quadrants.size).toBe(4);
    expect(seedFromId('plant-a')).toBe(seedFromId('plant-a'));
    expect(seedFromId('plant-a')).not.toBe(seedFromId('plant-b'));
  });
});

describe('month labels', () => {
  it('describes runs of months, including over the new year', () => {
    expect(monthRange([10, 11])).toBe('Oct to Nov');
    expect(monthRange([11, 12, 1])).toBe('Nov to Jan');
    expect(monthRange([8])).toBe('Aug');
    expect(monthRange([])).toBe('none');
  });
});
