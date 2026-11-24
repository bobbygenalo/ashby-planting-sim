import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import { balloonBunches, birthdayCalendar, birthdayDay, birthdaysOn, cakeOn, greeting, nameList, partyOn, presentSpots, sunsetMinute } from '../src/engine/birthday';
import { distanceToPolygon, pointInPolygon } from '../src/engine/geometry';
import { buildLifeWorld, LifeSim, type LifeWorldInput } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const residents = site.residents!;
const el = (type: HardscapeElement['type'], points: [number, number][], materialId: string, id: string): HardscapeElement => ({ id, type, points, materialId, height: type === 'table' ? 2.5 : 0, depthIn: 3, width: 0, existing: false });
const PATIO = el('patio', [[28, 100], [42, 100], [42, 112], [28, 112]], 'concrete', 'patio');
const TABLE = el('table', [[29.5, 102.5], [40.5, 102.5], [40.5, 109], [29.5, 109]], 'outdoor-table', 'tbl');
const input = (hardscape?: HardscapeElement[]): LifeWorldInput => ({ site, structures, hardscape: hardscape ?? [...(site.hardscape as HardscapeElement[]), PATIO, TABLE], materials: mats, plants: [], month: 3, engine });
const setup = (tweak?: (c: EngineConfig['life']) => void, hardscape?: HardscapeElement[], seed = 3) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  cfg.people.visitBias = 0;
  tweak?.(cfg);
  const w = buildLifeWorld({ ...input(hardscape), engine: { ...engine, life: cfg } });
  const s = new LifeSim(w, cfg, seed, { people: 10, dogs: 1, bees: false });
  return { s, w, cfg };
};
const run = (s: LifeSim, seconds: number) => { for (let t = 0; t < seconds; t += 0.1) s.step(0.1); };
const day = (month: number, d: number) => birthdayDay(site, engine, month, d)!;

describe('whose birthday it is', () => {
  it('knows all fifteen residents and their dates, with two sharing June 4', () => {
    expect(residents).toHaveLength(15);
    for (const [n, m, d] of [['Jemma', 3, 30], ['Kepler', 7, 6], ['Bobby', 8, 15], ['Nonna', 3, 9], ['Grandpa', 4, 22], ['PopZ', 10, 17], ['Oma', 3, 4], ['Madeleine', 6, 4], ['Abby', 6, 4], ['Kody', 12, 10], ['Henry', 8, 11], ['Caroline', 2, 24], ['Cate', 9, 18], ['Chris', 4, 2], ['Beth', 12, 2]] as const) {
      expect(birthdaysOn(m, d, residents), n).toContain(n);
    }
    expect(birthdaysOn(6, 4, residents).sort()).toEqual(['Abby', 'Madeleine']);
    expect(birthdaysOn(1, 1, residents)).toEqual([]);
    expect(birthdaysOn(2, 29, residents)).toEqual([]);
  });

  it('lists the dates of the year in order, one per day, for jumping to', () => {
    const cal = birthdayCalendar(residents);
    expect(cal).toHaveLength(14); // fifteen people, one shared day
    expect(cal.map((c) => c.doy)).toEqual([...cal.map((c) => c.doy)].sort((a, b) => a - b));
    expect(cal.find((c) => c.month === 6 && c.day === 4)!.names.sort()).toEqual(['Abby', 'Madeleine']);
    expect(cal[0].names).toEqual(['Caroline']); // February 24 is first
    expect(cal[cal.length - 1].names).toEqual(['Kody']); // December 10 is last
  });

  it('reads the greeting with the right names', () => {
    expect(greeting(['Jemma'])).toBe('Happy Birthday, Jemma!');
    expect(greeting(['Madeleine', 'Abby'])).toBe('Happy Birthday, Madeleine & Abby!');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B & C');
    expect(greeting(birthdaysOn(6, 4, residents))).toMatch(/^Happy Birthday, (Madeleine & Abby|Abby & Madeleine)!$/);
  });
});

describe('sunset and the party around it', () => {
  it('finds sunset: about 5 pm in early December and about 8 pm at midsummer, in Los Angeles', () => {
    const dec = sunsetMinute(site, engine, 12, 10)!, jun = sunsetMinute(site, engine, 6, 21)!;
    expect(dec).toBeGreaterThan(16 * 60 + 30);
    expect(dec).toBeLessThan(17 * 60 + 15);
    expect(jun).toBeGreaterThan(19 * 60 + 40);
    expect(jun).toBeLessThan(20 * 60 + 20);
    expect(sunsetMinute(site, engine, 12, 10)).toBe(dec); // stable (cached)
    // it moves a little each day
    expect(sunsetMinute(site, engine, 3, 30)!).toBeGreaterThan(sunsetMinute(site, engine, 3, 9)!);
  });

  it('runs the party three hours either side of sunset, and the cake an hour either side', () => {
    const b = day(3, 30);
    expect(b.names).toEqual(['Jemma']);
    expect(b.partyStart).toBe(b.sunset - 180);
    expect(b.partyEnd).toBe(b.sunset + 180);
    expect(b.cakeStart).toBe(b.sunset - 60);
    expect(b.cakeEnd).toBe(b.sunset + 60);
    expect(b.movieStart).toBe(b.sunset);
    expect(partyOn(b, b.sunset - 181)).toBe(false);
    expect(partyOn(b, b.sunset - 179)).toBe(true);
    expect(partyOn(b, b.sunset + 179)).toBe(true);
    expect(partyOn(b, b.sunset + 180)).toBe(false);
    expect(cakeOn(b, b.sunset - 61)).toBe(false);
    expect(cakeOn(b, b.sunset - 59)).toBe(true);
    expect(cakeOn(b, b.sunset + 59)).toBe(true);
    expect(cakeOn(b, b.sunset + 61)).toBe(false);
    expect(birthdayDay(site, engine, 5, 5)).toBeNull();
    expect(partyOn(null, 1000)).toBe(false);
  });
});

describe('presents', () => {
  it('lie mostly close around the communal table, the rest in the party yard, apart from one another and from plants', () => {
    const { w } = setup();
    const yard = site.zones.filter((z) => z.id === engine.birthday.zone).map((z) => z.polygon);
    const list = presentSpots(w, engine.birthday, 7, yard);
    expect(list.length).toBeGreaterThanOrEqual(engine.birthday.presents.count - 2);
    expect(list.length).toBeLessThanOrEqual(engine.birthday.presents.count);
    const table = w.tables[0];
    const near = list.filter((p) => Math.hypot(p.x - table.center[0], p.y - table.center[1]) <= engine.birthday.presents.nearTableFt[1] + 4.5);
    expect(near.length / list.length).toBeGreaterThan(0.5);
    expect(near.length).toBeLessThan(list.length); // some are further out
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      expect(p.size).toBeGreaterThanOrEqual(engine.birthday.presents.sizeFt[0]);
      expect(p.size).toBeLessThanOrEqual(engine.birthday.presents.sizeFt[1]);
      expect(w.reachable).toContain(Math.floor(p.y / w.cell) * w.nx + Math.floor(p.x / w.cell)); // on open, walkable ground
      expect(pointInPolygon(p.x, p.y, TABLE.points)).toBe(false);
      for (const st of structures) expect(pointInPolygon(p.x, p.y, st.footprint)).toBe(false);
      for (let j = i + 1; j < list.length; j++) expect(Math.hypot(p.x - list[j].x, p.y - list[j].y)).toBeGreaterThan((p.size + list[j].size) * 0.8);
    }
    expect(new Set(list.map((p) => p.color)).size).toBeGreaterThan(2);
    expect(presentSpots(w, engine.birthday, 7, yard)).toEqual(list);
    expect(presentSpots(w, engine.birthday, 8, yard)).not.toEqual(list);
  });

  it('go to the party yard when there is no table', () => {
    const { w } = setup(undefined, site.hardscape as HardscapeElement[]);
    const yard = site.zones.filter((z) => z.id === engine.birthday.zone).map((z) => z.polygon);
    const list = presentSpots(w, engine.birthday, 7, yard);
    expect(list.length).toBeGreaterThan(5);
    for (const p of list) expect(yard.some((poly) => pointInPolygon(p.x, p.y, poly))).toBe(true);
  });
});

describe('the party in the sim', () => {
  it('turns on three hours either side of sunset, only on a birthday, and not in the night', () => {
    const b = day(3, 30);
    const { s } = setup();
    s.setBirthday(b);
    s.setClock(b.sunset - 181);
    expect(s.party).toBe(false);
    expect(s.presentsOut).toBe(false);
    s.setClock(b.sunset - 170);
    expect(s.party).toBe(true);
    expect(s.presentsOut).toBe(true);
    s.setClock(b.sunset + 179);
    expect(s.party).toBe(true);
    s.setClock(b.sunset + 181);
    expect(s.party).toBe(false);
    expect(s.presentsOut).toBe(true); // the presents stay out until night
    s.setClock(23 * 60 + 30);
    expect(s.presentsOut).toBe(false);
    const plain = setup().s;
    plain.setBirthday(null);
    plain.setClock(b.sunset);
    expect(plain.party).toBe(false);
    expect(plain.cake).toBe(false);
  });

  it('gathers people in the party yard, mostly, while it is on', () => {
    const b = day(7, 6);
    const yard = site.zones.find((z) => z.id === engine.birthday.zone)!.polygon;
    const inYard = (s: LifeSim) => s.walkers.filter((wk) => wk.kind === 'person' && pointInPolygon(wk.x, wk.y, yard)).length;
    // Over several seeds, so one lucky draw cannot decide it: with the party on, more people are in the yard than without.
    let withParty = 0, without = 0, most = 0;
    for (const seed of [3, 4, 5, 6]) {
      const party = setup((c) => { c.party.backyardBias = 1; }, undefined, seed);
      party.s.setBirthday(b);
      party.s.setClock(b.sunset - 150); // party on, cake not out yet
      run(party.s, 150);
      const control = setup(undefined, undefined, seed);
      control.s.setClock(b.sunset - 150);
      run(control.s, 150);
      withParty += inYard(party.s);
      without += inYard(control.s);
      most = Math.max(most, inYard(party.s));
      expect(inYard(party.s), `seed ${seed}`).toBeGreaterThanOrEqual(6); // most of the ten
    }
    expect(withParty).toBeGreaterThanOrEqual(without);
    expect(most).toBeGreaterThanOrEqual(7);
  });

  it('puts the cake on the table, with everyone crowded round it facing it and cheering, for the hour either side of sunset', () => {
    const b = day(3, 30);
    const { s, w } = setup();
    s.setBirthday(b);
    s.setClock(b.sunset - 62);
    expect(s.cake).toBe(false);
    s.setClock(b.sunset - 30);
    expect(s.cake).toBe(true);
    run(s, 90);
    const around = s.walkers.filter((wk) => wk.act?.kind === 'cake' && wk.act.phase === 'gather');
    expect(around.length).toBeGreaterThanOrEqual(7); // nearly everyone of the ten, up to the places at the table
    expect(around.length).toBeLessThanOrEqual(8);
    for (const wk of around) {
      expect(distanceToPolygon(wk.x, wk.y, TABLE.points)).toBeLessThan(2.2);
      expect(wk.cheer).toBe(true);
      const seat = w.tables[0].seats.find((q) => wk.act?.kind === 'cake' && q.id === wk.act.seat)!;
      expect(Math.abs(Math.atan2(Math.sin(wk.heading - seat.facing), Math.cos(wk.heading - seat.facing)))).toBeLessThan(1e-6);
      expect(wk.sit).toBe(0); // standing, not seated
    }
    expect(new Set(around.map((wk) => (wk.act as { seat: string }).seat)).size).toBe(around.length); // one place each
    s.setClock(b.sunset + 61);
    expect(s.cake).toBe(false);
    expect(s.walkers.some((wk) => wk.act?.kind === 'cake')).toBe(false);
    expect(s.walkers.every((wk) => !wk.cheer)).toBe(true);
  });

  it('has no cake when there is no table, and none on an ordinary day', () => {
    const b = day(3, 30);
    const none = setup(undefined, site.hardscape as HardscapeElement[]);
    none.s.setBirthday(b);
    none.s.setClock(b.sunset);
    expect(none.s.cake).toBe(false);
    const ordinary = setup();
    ordinary.s.setBirthday(null);
    ordinary.s.setClock(18 * 60);
    expect(ordinary.s.cake).toBe(false);
  });

  it('starts the projector at sunset on a birthday, with the greeting, instead of 8 pm', () => {
    const b = day(3, 30); // sunset before 8 pm
    expect(b.sunset).toBeLessThan(engine.life.movie.startMin);
    const { s } = setup();
    s.setBirthday(b);
    s.setClock(b.sunset - 1);
    expect(s.movieOn).toBe(false);
    s.setClock(b.sunset + 1);
    expect(s.movieOn).toBe(true);
    s.setClock(23 * 60);
    expect(s.movieOn).toBe(false);
    // an ordinary evening still waits for 8 pm
    const plain = setup().s;
    plain.setBirthday(null);
    plain.setClock(b.sunset + 5);
    expect(plain.movieOn).toBe(false);
    plain.setClock(engine.life.movie.startMin + 1);
    expect(plain.movieOn).toBe(true);
  });
});

describe('balloons outside the doors', () => {
  it('tie a bunch on each side of every door, just outside the wall and clear of the building', () => {
    const doors = site.doors!;
    const bunches = balloonBunches(site, structures, engine.birthday, 5);
    expect(bunches).toHaveLength(doors.length * 2);
    for (const d of doors) {
      const mine = bunches.filter((b) => b.door === d.id);
      expect(mine, d.id).toHaveLength(2);
      // one on each side of the door
      const across = mine.map((b) => (b.x - d.point[0]) * -d.outward[1] + (b.y - d.point[1]) * d.outward[0]);
      expect(across[0] * across[1]).toBeLessThan(0);
      for (const b of mine) {
        expect(Math.hypot(b.x - d.point[0], b.y - d.point[1])).toBeLessThan(3);
        expect((b.x - d.point[0]) * d.outward[0] + (b.y - d.point[1]) * d.outward[1]).toBeCloseTo(engine.birthday.balloons.outFt, 6); // out from the wall
        for (const st of structures) expect(pointInPolygon(b.x, b.y, st.footprint)).toBe(false);
        expect(b.balloons).toHaveLength(engine.birthday.balloons.perBunch);
        for (const bl of b.balloons) {
          expect(bl.length).toBeGreaterThanOrEqual(engine.birthday.balloons.stringFt[0]);
          expect(bl.length).toBeLessThanOrEqual(engine.birthday.balloons.stringFt[1]);
          expect(engine.birthday.balloons.colors).toContain(bl.color);
        }
        expect(new Set(b.balloons.map((bl) => bl.color)).size).toBeGreaterThan(2);
      }
    }
    expect(bunches.some((b) => b.door === 'garage-front')).toBe(true);
    expect(bunches.some((b) => b.door === 'adu-front')).toBe(true);
    expect(bunches.some((b) => b.door.startsWith('house'))).toBe(true);
    expect(balloonBunches(site, structures, engine.birthday, 5)).toEqual(bunches);
  });

  it('leave out a building that is not in the plan', () => {
    const noAdu = activeStructures(site, { aduEnabled: false });
    const bunches = balloonBunches(site, noAdu, engine.birthday, 5);
    expect(bunches.some((b) => b.door === 'adu-front')).toBe(false);
    expect(bunches).toHaveLength((site.doors!.length - 1) * 2);
  });

  it('are up from the morning of a birthday until night, and only then', () => {
    const b = day(7, 6);
    const { s } = setup();
    s.setBirthday(b);
    s.setClock(7 * 60);
    expect(s.balloonsOut).toBe(false);
    s.setClock(engine.life.party.balloonsFromMin + 1);
    expect(s.balloonsOut).toBe(true);
    s.setClock(b.sunset);
    expect(s.balloonsOut).toBe(true);
    s.setClock(23 * 60 + 30);
    expect(s.balloonsOut).toBe(false);
    const plain = setup().s;
    plain.setBirthday(null);
    plain.setClock(14 * 60);
    expect(plain.balloonsOut).toBe(false);
  });
});
