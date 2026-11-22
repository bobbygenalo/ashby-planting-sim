import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { buildLifeWorld, isInside, LifeSim, type LifeWorldInput } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const el = (type: HardscapeElement['type'], points: [number, number][], materialId: string, id: string): HardscapeElement => ({
  id, type, points, materialId, height: type === 'table' ? 2.5 : 0, depthIn: 3, width: 0, existing: false,
});
const PATIO = el('patio', [[28, 70], [42, 70], [42, 82], [28, 82]], 'concrete', 'patio');
const TABLE = el('table', [[29, 72], [40, 72], [40, 78.5], [29, 78.5]], 'outdoor-table', 'tbl');
const input = (over: Partial<LifeWorldInput> = {}): LifeWorldInput => ({
  site, structures, hardscape: [...(site.hardscape as HardscapeElement[]), PATIO, TABLE], materials: mats, plants: [], month: 5, engine, ...over,
});
const sim = (over: Partial<LifeWorldInput> = {}, cfgTweak?: (c: EngineConfig['life']) => void, seed = 3) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  cfgTweak?.(cfg);
  const w = buildLifeWorld({ ...input(over), engine: { ...engine, life: cfg } });
  return { s: new LifeSim(w, cfg, seed, { people: 8, dogs: 1, bees: false }), w, cfg };
};
const run = (s: LifeSim, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 0.1) {
    s.step(0.1);
    each?.();
  }
};

describe('the table in the life sim', () => {
  it('offers its seats, in a ring, behind which people can stand', () => {
    const { w } = sim();
    expect(w.tables).toHaveLength(1);
    const t = w.tables[0];
    expect(t.seats.length).toBe(8);
    for (const seat of t.seats) {
      expect(pointInPolygon(seat.chair[0], seat.chair[1], TABLE.points)).toBe(true);
      expect(pointInPolygon(seat.approach[0], seat.approach[1], TABLE.points)).toBe(false);
      expect(distanceToPolygon(seat.approach[0], seat.approach[1], TABLE.points)).toBeLessThan(2);
      // the chair slides away from the table: outward is away from its middle
      expect((seat.chair[0] - t.center[0]) * seat.out[0] + (seat.chair[1] - t.center[1]) * seat.out[1]).toBeGreaterThan(0);
    }
  });

  it('has people come, pull out a chair, sit, talk, stand, and push it in', () => {
    const { s, cfg } = sim({}, (c) => { c.dining.bias = 1; c.dining.talkS = [8, 10]; c.people.visitBias = 0; });
    const seen = { pull: false, sat: false, talking: false, headTurn: false, chairOut: 0, seated: 0, finished: false };
    run(s, 160, () => {
      for (const wk of s.walkers) {
        if (wk.act?.kind !== 'dine') continue;
        if (wk.act.phase === 'pull') seen.pull = true;
        if (wk.sit > 0.99) { seen.sat = true; seen.seated = Math.max(seen.seated, s.walkers.filter((o) => o.sit > 0.99).length); }
        if (wk.talking) seen.talking = true;
        if (Math.abs(wk.headTurn) > 0.2) seen.headTurn = true;
      }
      seen.chairOut = Math.max(seen.chairOut, ...[...s.chairs.values()]);
    });
    expect(seen.pull).toBe(true);
    expect(seen.sat).toBe(true);
    expect(seen.seated).toBeGreaterThanOrEqual(2); // a group, not one person
    expect(seen.talking).toBe(true);
    expect(seen.headTurn).toBe(true); // listeners turn toward the speaker
    expect(seen.chairOut).toBeCloseTo(1, 1); // a chair really is pulled all the way out
    // later everyone has finished: no one is left seated, and every chair is pushed back in
    cfg.dining.bias = 0; // no new groups; let those at the table finish
    run(s, 60);
    expect(s.walkers.every((wk) => wk.sit === 0 && wk.act === null)).toBe(true);
    expect([...s.chairs.values()].every((v) => v < 0.05)).toBe(true);
  });

  it('sits no two people in the same chair, and sits each at an approach cell they could reach', () => {
    const { s } = sim({}, (c) => { c.dining.bias = 1; c.people.visitBias = 0; });
    run(s, 90, () => {
      const seats = s.walkers.flatMap((wk) => (wk.act?.kind === 'dine' ? [wk.act.seat] : []));
      expect(new Set(seats).size).toBe(seats.length);
    });
  });

  it('seats sitters facing the table, lower than they stand, and speaking one at a time', () => {
    const { s, w } = sim({}, (c) => { c.dining.bias = 1; c.dining.talkS = [60, 70]; c.people.visitBias = 0; });
    let checked = false;
    run(s, 80, () => {
      const sitting = s.walkers.filter((wk) => wk.sit > 0.99);
      if (sitting.length < 2) return;
      checked = true;
      expect(s.walkers.filter((wk) => wk.talking).length).toBeLessThanOrEqual(1);
      for (const wk of sitting) {
        const seat = w.tables[0].seats.find((q) => wk.act?.kind === 'dine' && q.id === wk.act.seat)!;
        expect(Math.abs(Math.atan2(Math.sin(wk.heading - seat.facing), Math.cos(wk.heading - seat.facing)))).toBeLessThan(1e-6);
        expect(pointInPolygon(wk.x, wk.y, TABLE.points)).toBe(true);
      }
    });
    expect(checked).toBe(true);
  });

  it('does nothing when the plan has no table', () => {
    const { s, w } = sim({ hardscape: site.hardscape as HardscapeElement[] }, (c) => { c.dining.bias = 1; });
    expect(w.tables).toHaveLength(0);
    run(s, 40);
    expect(s.walkers.some((wk) => wk.act !== null)).toBe(false);
  });
});

describe('the evening movie', () => {
  it('has a screen on the garage\'s east wall with open ground in front of it', () => {
    const { w } = sim();
    const sc = w.screen!;
    expect(sc).not.toBeNull();
    const garage = structures.find((st) => st.id === 'garage')!;
    expect(sc.x).toBeCloseTo(Math.max(...garage.footprint.map((p) => p[0])), 6);
    expect(sc.y).toBeGreaterThan(Math.min(...garage.footprint.map((p) => p[1])));
    expect(sc.y).toBeLessThan(Math.max(...garage.footprint.map((p) => p[1])));
    expect(sc.spots.length).toBeGreaterThan(5);
    for (const [x, y] of sc.spots) {
      expect(x).toBeGreaterThan(sc.x + engine.life.movie.spotFromWallFt[0] - 1e-6);
      expect(Math.abs(y - sc.y)).toBeLessThanOrEqual(engine.life.movie.spotLateralFt + 1e-6);
    }
    expect(sc.projector[0]).toBeGreaterThan(Math.max(...sc.spots.map((p) => p[0])));
  });

  it('shows between 8 and 11 pm only, and draws people to it, facing the screen, until it ends', () => {
    const { s, w } = sim({}, (c) => { c.movie.attendBias = 1; c.movie.joinBias = 1; });
    s.setClock(19 * 60 + 59);
    expect(s.movieOn).toBe(false);
    run(s, 5);
    expect(s.walkers.some((wk) => wk.act?.kind === 'watch')).toBe(false);
    s.setClock(20 * 60);
    expect(s.movieOn).toBe(true);
    run(s, 90);
    const watchers = s.walkers.filter((wk) => wk.act?.kind === 'watch' && wk.act.phase === 'watch');
    expect(watchers.length).toBeGreaterThanOrEqual(4);
    const sc = w.screen!;
    for (const wk of watchers) {
      expect(wk.x).toBeGreaterThan(sc.x + 5);
      const want = Math.atan2(sc.y - wk.y, sc.x - wk.x);
      expect(Math.abs(Math.atan2(Math.sin(wk.heading - want), Math.cos(wk.heading - want)))).toBeLessThan(0.1);
    }
    // they keep apart
    const spots = watchers.map((wk) => (wk.act as { spot: [number, number] }).spot);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThanOrEqual(engine.life.movie.spotGapFt - 1e-6);
    s.setClock(22 * 60 + 59);
    expect(s.movieOn).toBe(true);
    s.setClock(23 * 60);
    expect(s.movieOn).toBe(false);
    expect(s.walkers.some((wk) => wk.act?.kind === 'watch')).toBe(false);
  });

  it('shows nothing in the daytime, and nothing when there is no garage', () => {
    const { s } = sim({}, (c) => { c.movie.attendBias = 1; c.movie.joinBias = 1; });
    s.setClock(13 * 60);
    run(s, 30);
    expect(s.movieOn).toBe(false);
    expect(s.walkers.some((wk) => wk.act !== null)).toBe(false);
    const none = sim({ structures: structures.filter((st) => st.id !== 'garage') });
    expect(none.w.screen).toBeNull();
    none.s.setClock(21 * 60);
    expect(none.s.movieOn).toBe(false);
  });
});

describe('night: people and dogs go in at 11 pm and come out at 6 am', () => {
  const allIn = (s: LifeSim) => s.walkers.every((wk) => isInside(wk));
  const noneIn = (s: LifeSim) => s.walkers.every((wk) => !isInside(wk));

  it('walk to a door and go in when night falls as time passes, dogs and all', () => {
    const { s } = sim({}, (c) => { c.people.visitBias = 0; });
    s.setClock(22 * 60 + 59);
    run(s, 10);
    expect(noneIn(s)).toBe(true);
    s.setClock(23 * 60);
    expect(s.night).toBe(true);
    expect(allIn(s)).toBe(false); // they are on their way, not gone at once
    run(s, 150);
    expect(allIn(s)).toBe(true);
    expect(s.walkers.some((wk) => wk.kind === 'dog')).toBe(true);
    // and they stay in all night, nothing starting up
    run(s, 120);
    expect(allIn(s)).toBe(true);
    expect(s.walkers.every((wk) => wk.act === null)).toBe(true);
  });

  it('are gone at once when the clock jumps into the night, and back out one by one when it jumps to morning', () => {
    const { s } = sim({}, (c) => { c.people.visitBias = 0; });
    s.setClock(12 * 60);
    s.setClock(23 * 60 + 30);
    expect(allIn(s)).toBe(true);
    s.setClock(2 * 60);
    run(s, 60);
    expect(allIn(s)).toBe(true);
    s.setClock(5 * 60 + 59);
    run(s, 20);
    expect(allIn(s)).toBe(true);
    s.setClock(6 * 60);
    expect(s.night).toBe(false);
    run(s, engine.life.night.riseSpreadS + 40);
    expect(noneIn(s)).toBe(true);
    // they then go about the day again
    const where = s.walkers.map((wk) => [wk.x, wk.y]);
    run(s, 60);
    expect(s.walkers.some((wk, i) => Math.hypot(wk.x - where[i][0], wk.y - where[i][1]) > 3)).toBe(true);
  });

  it('come out spread over the morning, not all in the same second', () => {
    const { s } = sim({}, (c) => { c.people.visitBias = 0; });
    s.setClock(12 * 60);
    s.setClock(23 * 60 + 30);
    s.setClock(6 * 60 + 1); // a jump past the whole night
    run(s, 3);
    const early = s.walkers.filter((wk) => !isInside(wk)).length;
    run(s, engine.life.night.riseSpreadS + 40);
    expect(noneIn(s)).toBe(true);
    expect(early).toBeLessThan(s.walkers.length);
  });

  it('keep the movie and the table to the evening and the day', () => {
    const { s } = sim({}, (c) => { c.movie.attendBias = 1; c.movie.joinBias = 1; c.dining.bias = 1; });
    s.setClock(22 * 60 + 59);
    s.setClock(23 * 60);
    expect(s.movieOn).toBe(false);
    run(s, 100);
    expect(s.walkers.every((wk) => wk.act === null)).toBe(true);
  });

  it('simply hides them overnight in a plan with no doors, and brings them back where they stood', () => {
    const noDoors = { ...site, doors: [] };
    const { s } = sim({ site: noDoors }, (c) => { c.people.visitBias = 0; });
    s.setClock(12 * 60);
    run(s, 5);
    const where = s.walkers.map((wk) => [wk.x, wk.y]);
    s.setClock(23 * 60 + 30);
    expect(allIn(s)).toBe(true);
    run(s, 30);
    s.walkers.forEach((wk, i) => { expect(wk.x).toBe(where[i][0]); expect(wk.y).toBe(where[i][1]); });
    s.setClock(6 * 60 + 5);
    expect(noneIn(s)).toBe(true);
  });
});
