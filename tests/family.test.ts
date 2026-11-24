import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import siteRaw from '../src/data/site.json';
import { buildLifeWorld, LifeSim } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PersonSpec } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const roster = engine.life.people.roster;
const site = loadSite(siteRaw);
const inFamily = (f: string) => roster.filter((p) => p.family === f);
const adults = (l: PersonSpec[]) => l.filter((p) => p.age >= 18);
// The 11 and 14 year olds are the family's teens; the 9 and 3 year olds are its kids.
const teens = (l: PersonSpec[]) => l.filter((p) => p.age >= 11 && p.age < 18);
const kids = (l: PersonSpec[]) => l.filter((p) => p.age < 11);

describe('the families and their shirts', () => {
  it('has five families that add up to the whole cast, each in one color of shirt', () => {
    expect(new Set(roster.map((p) => p.family))).toEqual(new Set(['green', 'blue', 'yellow', 'purple', 'red']));
    expect(roster).toHaveLength(15);
    for (const f of ['green', 'blue', 'yellow', 'purple', 'red']) {
      const colors = new Set(inFamily(f).map((p) => p.shirt));
      expect(colors.size, f).toBe(1);
      expect([...colors][0], f).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(roster.map((p) => p.shirt)).size).toBe(5); // five families, five colors
  });

  it('puts five people in green: two adults, two teens and a kid', () => {
    const g = inFamily('green');
    expect(g).toHaveLength(5);
    expect([adults(g).length, teens(g).length, kids(g).length]).toEqual([2, 2, 1]);
  });

  it('puts three in blue (two adults and a kid) and three in red (two adults and a kid)', () => {
    for (const f of ['blue', 'red']) {
      const l = inFamily(f);
      expect(l, f).toHaveLength(3);
      expect([adults(l).length, teens(l).length, kids(l).length], f).toEqual([2, 0, 1]);
    }
  });

  it('puts two in yellow and two in purple, each a man and a woman, all adults, all with gray hair', () => {
    const grays = new Set(roster.filter((p) => p.hair).map((p) => p.hair));
    expect(grays.size).toBe(1); // one gray
    for (const f of ['yellow', 'purple']) {
      const l = inFamily(f);
      expect(l, f).toHaveLength(2);
      expect(adults(l), f).toHaveLength(2);
      expect(l.map((p) => p.sex).sort(), f).toEqual(['f', 'm']);
      for (const p of l) expect(p.hair, f).toBeDefined();
    }
    for (const f of ['green', 'blue', 'red']) for (const p of inFamily(f)) expect(p.hair, f).toBeUndefined(); // gray hair is only theirs
  });

  it('keeps the toddler with his family: his leader in the sim is an adult in his own family', () => {
    const w = buildLifeWorld({ site, structures: activeStructures(site, { aduEnabled: true }), hardscape: site.hardscape as HardscapeElement[], materials: materialsRaw as unknown as Material[], plants: [], month: 5, engine });
    const s = new LifeSim(w, engine.life, 3, { people: 15, dogs: 0, bees: false });
    const toddler = s.walkers.find((p) => p.age < 6)!;
    const leader = s.walkers[toddler.leader!];
    expect(leader.family).toBe(toddler.family);
    expect(leader.age).toBeGreaterThanOrEqual(18);
  });

  it('gives every walker the shirt and hair of their roster entry', () => {
    const w = buildLifeWorld({ site, structures: activeStructures(site, { aduEnabled: true }), hardscape: site.hardscape as HardscapeElement[], materials: materialsRaw as unknown as Material[], plants: [], month: 5, engine });
    const s = new LifeSim(w, engine.life, 3, { people: 15, dogs: 0, bees: false });
    s.walkers.forEach((wk, i) => {
      expect(wk.shirt, `${i}`).toBe(roster[i].shirt);
      expect(wk.hair, `${i}`).toBe(roster[i].hair);
      expect(wk.family, `${i}`).toBe(roster[i].family);
    });
  });

  it('shows a mix of families among the eight people there are to begin with', () => {
    const first = roster.slice(0, engine.life.people.defaultCount);
    expect(new Set(first.map((p) => p.family)).size).toBeGreaterThanOrEqual(3);
  });
});
