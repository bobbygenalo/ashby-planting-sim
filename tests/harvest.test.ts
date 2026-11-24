import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { basketDims, basketPicks, buildLifeWorld, isInside, LifeSim, pickBallFt, pickBulkFt3, pickVolumeFt3 } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });
const placed = (list: [string, number, number][], years = 12): PlacedPlant[] =>
  list.map(([speciesId, x, y], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, years * 12, engine.growth) };
  });
// Fruit in November: an apple, a kumquat and a lemon, each a different kind of fruit.
const ORCHARD: [string, number, number][] = [['malus-mutsu', 34, 100], ['citrus-kumquat', 40, 96], ['citrus-meyer-lemon', 30, 108]];
const world = (plants: PlacedPlant[], month: number, cfg = engine.life) =>
  buildLifeWorld({ site, structures, hardscape: site.hardscape as HardscapeElement[], materials: mats, plants, month, engine: { ...engine, life: cfg } });
const sim = (over: { month?: number; tweak?: (c: EngineConfig['life']) => void; seed?: number; plants?: PlacedPlant[] } = {}) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  cfg.harvest.bias = 1;
  cfg.people.visitBias = 0;
  over.tweak?.(cfg);
  const w = world(over.plants ?? placed(ORCHARD), over.month ?? 11, cfg);
  return { s: new LifeSim(w, cfg, over.seed ?? 5, { people: 8, dogs: 0, bees: false }), w, cfg };
};
const run = (s: LifeSim, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 0.1) {
    s.step(0.1);
    each?.();
  }
};

describe('what there is to pick', () => {
  it('lists the plants with ripe fruit this month, with what the fruit looks like, and nothing out of season', () => {
    const nov = world(placed(ORCHARD), 11);
    expect(nov.harvest.map((h) => h.speciesId).sort()).toEqual(['citrus-kumquat', 'citrus-meyer-lemon', 'malus-mutsu']);
    for (const h of nov.harvest) {
      expect(h.color).toMatch(/^#/);
      expect(h.diameterFt).toBeGreaterThan(0);
    }
    expect(world(placed(ORCHARD), 3).harvest.map((h) => h.speciesId).sort()).toEqual(['citrus-kumquat', 'citrus-meyer-lemon']);
    expect(world(placed(ORCHARD), 7).harvest).toEqual([]);
  });

  it('skips plants too young to fruit', () => {
    expect(world(placed(ORCHARD, 0), 11).harvest).toEqual([]);
  });
});

describe('picking into a basket', () => {
  it('has people walk to a plant with ripe fruit, stand within arm\'s reach beyond the canopy, and face it', () => {
    const { s, w, cfg } = sim();
    let picking = 0;
    run(s, 120, () => {
      for (const wk of s.walkers) {
        if (wk.act?.kind !== 'harvest' || wk.act.phase !== 'pick') continue;
        const a = wk.act;
        const plant = w.harvest.find((q) => q.id === a.plant)!;
        picking++;
        const d = Math.hypot(wk.x - plant.x, wk.y - plant.y);
        expect(d).toBeGreaterThanOrEqual(plant.radius + cfg.harvest.standMinFt - 0.8);
        expect(d).toBeLessThanOrEqual(plant.radius + cfg.harvest.standMaxFt + 0.8);
        expect(wk.basket).not.toBeNull();
      }
    });
    expect(picking).toBeGreaterThan(30);
  });

  it('fills the basket one piece at a time, each flying from the plant, in the fruit\'s own color, never past its capacity', () => {
    const { s, w } = sim();
    const colors = new Set(w.harvest.map((h) => h.color));
    let flights = 0, maxItems = 0, over = 0;
    const counts = new Map<number, number[]>();
    run(s, 150, () => {
      flights = Math.max(flights, s.flights.length);
      s.walkers.forEach((wk, i) => {
        if (!wk.basket) return;
        maxItems = Math.max(maxItems, wk.basket.items.length);
        if (wk.basket.used > wk.basket.volume + 1e-9) over++;
        for (const it of wk.basket.items) expect(colors.has(it.color)).toBe(true);
        const hist = counts.get(i) ?? [];
        if (hist[hist.length - 1] !== wk.basket.items.length) hist.push(wk.basket.items.length);
        counts.set(i, hist);
      });
    });
    expect(flights).toBeGreaterThan(0);
    expect(maxItems).toBeGreaterThanOrEqual(5);
    expect(over).toBe(0);
    // a basket only ever gains one piece at a time while it is being filled
    for (const hist of counts.values()) for (let k = 1; k < hist.length; k++) if (hist[k] > hist[k - 1]) expect(hist[k] - hist[k - 1]).toBe(1);
  });

  it('carries each piece in the hand: it is taken at the fruit, then travels over the basket, in step with the hand', () => {
    const { s, cfg } = sim();
    let seen = 0, rose = 0;
    const lastP = new Map<number, number>();
    run(s, 80, () => {
      for (const f of s.flights) {
        seen++;
        expect(f.p).toBeGreaterThanOrEqual(0);
        expect(f.p).toBeLessThan(1);
        expect(f.start[2]).toBeGreaterThan(0.4);
        const wk = s.walkers[f.walker];
        // the fruit is in the hand only from the pluck to the release
        expect(wk.pickU).toBeGreaterThanOrEqual(cfg.harvest.pluckAt - 1e-9);
        expect(wk.pickU).toBeLessThanOrEqual(cfg.harvest.releaseAt + 1e-9);
        const prev = lastP.get(f.walker);
        if (prev !== undefined && f.p > prev) rose++;
        lastP.set(f.walker, f.p);
      }
    });
    expect(seen).toBeGreaterThan(0);
    expect(rose).toBeGreaterThan(5); // it moves steadily toward the basket
    expect(cfg.harvest.pluckAt).toBeLessThan(cfg.harvest.releaseAt);
    expect(cfg.harvest.pickEveryS).toBeGreaterThan(2); // a reach, a pull and a carry take a few seconds, not a pump
  });

  it('moves a picker on to a different kind of fruit before the basket is full, then takes the basket in', () => {
    const { s } = sim({ tweak: (c) => { c.harvest.chunk = [3, 4]; c.harvest.basketVolumesFt3 = [0.65]; c.harvest.fillShare = [1, 1]; } });
    const kinds = new Map<number, Set<string>>();
    let carrying = 0, wentIn = 0, emptyAfter = 0;
    const was = new Map<number, boolean>();
    run(s, 400, () => {
      s.walkers.forEach((wk, i) => {
        if (wk.act?.kind === 'harvest') kinds.set(i, new Set(wk.act.species));
        if (wk.basket && wk.visit && wk.visit.phase !== 'inside' && wk.basket.items.length > 0) { carrying++; was.set(i, true); }
        if (wk.visit?.phase === 'inside' && was.get(i)) { wentIn++; if (wk.basket === null) emptyAfter++; was.set(i, false); }
      });
    });
    expect(Math.max(...[...kinds.values()].map((k) => k.size))).toBeGreaterThanOrEqual(2);
    expect(carrying).toBeGreaterThan(0);
    expect(wentIn).toBeGreaterThan(0);
    expect(emptyAfter).toBe(wentIn);
  });

  it('lets each picker choose how full to fill before heading in: some stop at half, some at full', () => {
    const finals = new Set<number>();
    for (let seed = 1; seed <= 6; seed++) {
      const { s } = sim({ seed });
      run(s, 60, () => { for (const wk of s.walkers) if (wk.act?.kind === 'harvest') finals.add(wk.act.final); });
    }
    expect(finals.size).toBeGreaterThan(3);
  });

  it('picks in stages: the hand goes out to a fruit within arm\'s reach, and a pick runs from rest to rest', () => {
    const { s, cfg } = sim();
    let aimed = 0, starts = 0, ends = 0, wasU = new Map<number, number>();
    run(s, 120, () => {
      s.walkers.forEach((wk, i) => {
        if (wk.aim) {
          aimed++;
          expect(wk.act?.kind).toBe('harvest');
          // the fruit is within an arm's stretch of the shoulder (about 0.4 of height)
          const d = Math.hypot(wk.aim[0] - wk.x, wk.aim[1] - wk.y, wk.aim[2] - wk.heightFt * 0.818);
          expect(d, `reach ${d.toFixed(2)} ft`).toBeLessThan(wk.heightFt * 0.4 + 0.15);
        } else expect(wk.pickU).toBe(0);
        const prev = wasU.get(i) ?? 0;
        if (prev === 0 && wk.pickU > 0) starts++;
        if (prev > 0 && wk.pickU === 0) ends++;
        wasU.set(i, wk.pickU);
      });
    });
    expect(aimed).toBeGreaterThan(30);
    expect(starts).toBeGreaterThan(3);
    expect(ends).toBeGreaterThanOrEqual(starts - 3);
    void cfg;
  });
});

describe('who picks, and when', () => {
  it('keeps children under the age limit and the toddler out of it, and at most the set number picking at once', () => {
    const { s, cfg } = sim();
    let most = 0;
    run(s, 150, () => {
      let now = 0;
      for (const wk of s.walkers) {
        if (wk.act?.kind === 'harvest' || wk.basket) {
          expect(wk.age).toBeGreaterThanOrEqual(cfg.harvest.minAge);
          now++;
        }
      }
      most = Math.max(most, now);
    });
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(cfg.harvest.maxPickers);
  });

  it('does nothing at night or before the hours, and when nothing is ripe', () => {
    const night = sim();
    night.s.setClock(60);
    run(night.s, 60, () => { for (const wk of night.s.walkers) expect(wk.basket).toBeNull(); });
    const early = sim();
    early.s.setClock(5 * 60);
    run(early.s, 30, () => { for (const wk of early.s.walkers) expect(wk.act?.kind === 'harvest').toBe(false); });
    const none = sim({ month: 7 });
    run(none.s, 60, () => { for (const wk of none.s.walkers) expect(wk.basket).toBeNull(); });
  });

  it('puts the basket down when night falls, and leaves nothing in the air', () => {
    const { s } = sim();
    run(s, 40);
    s.setClock(23 * 60 + 30);
    run(s, 3);
    expect(s.flights).toHaveLength(0);
    for (const wk of s.walkers) if (wk.act?.kind === 'harvest') throw new Error('still picking at night');
    run(s, 120);
    for (const wk of s.walkers) if (!isInside(wk)) expect(wk.basket).toBeNull();
  });

  it('is repeatable for a seed', () => {
    const a = sim({ seed: 11 }), b = sim({ seed: 11 });
    run(a.s, 60); run(b.s, 60);
    expect(a.s.walkers.map((w) => [w.x.toFixed(3), w.y.toFixed(3), w.basket?.items.length ?? -1])).toEqual(b.s.walkers.map((w) => [w.x.toFixed(3), w.y.toFixed(3), w.basket?.items.length ?? -1]));
  });
});

describe('how much a basket holds', () => {
  const cfg = engine.life.harvest;
  const nov = world(placed(ORCHARD), 11);
  const by = (id: string) => nov.harvest.find((h) => h.speciesId === id)!;

  it('sizes a basket from its volume, and holds the volume it was given', () => {
    for (const v of cfg.basketVolumesFt3) {
      const d = basketDims(v, cfg);
      expect(d.bottom).toBeCloseTo(d.top * cfg.basket.flare, 9);
      expect(d.depth).toBeCloseTo(d.top * cfg.basket.heightShare, 9);
      const frustum = (Math.PI * d.depth / 3) * (d.top ** 2 + d.top * d.bottom + d.bottom ** 2);
      expect(frustum).toBeCloseTo(v, 9);
    }
    expect(basketDims(0.65, cfg).top).toBeGreaterThan(basketDims(0.3, cfg).top);
    expect(basketDims(0.45, cfg).top * 2).toBeGreaterThan(0.8); // a sensible size: well over half a foot across
    expect(basketDims(0.45, cfg).top * 2).toBeLessThan(1.8);
  });

  it('fits fewer big fruit than small: an apple takes a whole pick, kumquats come by the handful', () => {
    const apple = by('malus-mutsu'), kumquat = by('citrus-kumquat');
    expect(pickVolumeFt3(apple, cfg)).toBeGreaterThan(pickVolumeFt3(kumquat, cfg) * 0.99); // never less than a handful
    expect(pickVolumeFt3(kumquat, cfg)).toBeCloseTo(cfg.handfulFt3, 9); // a small fruit: a handful
    expect(pickBallFt(apple, cfg)).toBeGreaterThanOrEqual(pickBallFt(kumquat, cfg));
    expect(pickBulkFt3(apple, cfg)).toBeCloseTo(pickVolumeFt3(apple, cfg) / cfg.packing, 9);
  });

  it('holds twice the picks in twice the volume, and never more than the volume allows', () => {
    const apple = by('malus-mutsu');
    const small = basketPicks(0.3, apple, cfg), big = basketPicks(0.6, apple, cfg);
    expect(big).toBeGreaterThanOrEqual(small * 2 - 1);
    expect(big).toBeLessThanOrEqual(small * 2 + 1);
    for (const v of cfg.basketVolumesFt3) expect(basketPicks(v, apple, cfg) * pickBulkFt3(apple, cfg)).toBeLessThanOrEqual(v + 1e-9);
    expect(basketPicks(0.3, apple, cfg)).toBeGreaterThan(8);
    expect(basketPicks(0.65, by('citrus-kumquat'), cfg)).toBeLessThan(120); // a drawable number of balls
  });

  it('stops a picker when the basket is full, with what is in it matching the volume used', () => {
    const { s, cfg: c } = sim({ tweak: (q) => { q.harvest.basketVolumesFt3 = [0.3]; q.harvest.fillShare = [1, 1]; q.harvest.chunk = [20, 20]; } });
    let most = 0, usedMax = 0;
    run(s, 300, () => {
      for (const wk of s.walkers) {
        if (!wk.basket) continue;
        expect(wk.basket.volume).toBeCloseTo(0.3, 9);
        expect(wk.basket.used).toBeLessThanOrEqual(0.3 + 1e-9);
        most = Math.max(most, wk.basket.items.length);
        usedMax = Math.max(usedMax, wk.basket.used);
      }
    });
    expect(most).toBeGreaterThan(5);
    expect(usedMax).toBeGreaterThan(0.3 - 0.02); // filled right to the brim, within one pick of full
    void c;
  });

  it('fills a basket in step with the fruit: used volume is the sum of its picks', () => {
    const { s, w } = sim();
    run(s, 120, () => {
      for (const wk of s.walkers) {
        if (!wk.basket || wk.basket.items.length === 0) continue;
        const plantFor = (color: string) => w.harvest.find((h) => h.color === color)!;
        const total = wk.basket.items.reduce((t, it) => t + pickBulkFt3(plantFor(it.color), cfg), 0);
        expect(wk.basket.used).toBeCloseTo(total, 6);
      }
    });
  });
});
